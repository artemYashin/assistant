import { createHash } from "node:crypto";
import type { SessionConfig } from "@github/copilot-sdk";
import { AppError, type Settings, type Store } from "./store.js";

export type LlmPurpose = "chat" | "review";
export function validOpenaiUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export function llmSelection(settings: Settings, purpose: LlmPurpose) {
  const provider = purpose === "review" ? settings.reviewProvider : settings.assistantProvider;
  const model =
    provider === "openai"
      ? purpose === "review"
        ? settings.openaiReviewModel
        : settings.openaiModel
      : purpose === "review"
        ? settings.reviewModel || settings.model
        : settings.model;
  const connectionId =
    provider === "copilot"
      ? "copilot"
      : createHash("sha256")
          .update(
            JSON.stringify([
              provider,
              settings.openaiBaseUrl.replace(/\/+$/, ""),
              settings.openaiWireApi,
            ]),
          )
          .digest("hex");
  return { provider, model, connectionId };
}
export function llmReady(store: Store, purpose: LlmPurpose) {
  const settings = store.settings();
  const selection = llmSelection(settings, purpose);
  return selection.provider === "copilot"
    ? !!store.secret("github.token")
    : validOpenaiUrl(settings.openaiBaseUrl) && !!selection.model.trim();
}
export function llmConfig(store: Store, purpose: LlmPurpose, override?: string) {
  const settings = store.settings();
  const selection = llmSelection(settings, purpose);
  const model = override?.trim() || selection.model;
  let provider: SessionConfig["provider"];
  if (selection.provider === "openai") {
    if (!validOpenaiUrl(settings.openaiBaseUrl) || !model)
      throw new AppError(400, "Укажите адрес OpenAI-совместимого API и модель в настройках.");
    provider = {
      type: "openai",
      baseUrl: settings.openaiBaseUrl,
      wireApi: settings.openaiWireApi,
      ...(store.secret("openai.apiKey") ? { apiKey: store.secret("openai.apiKey") } : {}),
    };
  }
  return { ...selection, model, config: provider };
}
export function assertLlmBinding(saved: string | undefined, current: string) {
  if ((saved || "copilot") !== current)
    throw new AppError(
      409,
      "Подключение модели изменилось. Верните прежний провайдер и адрес API для продолжения или запустите новое ревью. История сохранена.",
    );
}

export async function loadOpenaiModels(store: Store) {
  const settings = store.settings();
  const baseUrl = settings.openaiBaseUrl.trim().replace(/\/+$/, "");
  if (!validOpenaiUrl(baseUrl))
    throw new AppError(400, "Укажите адрес OpenAI-совместимого API в настройках.");
  const apiKey = store.secret("openai.apiKey");
  const snapshot = JSON.stringify([settings.openaiBaseUrl, settings.openaiWireApi, apiKey]);
  const connectionId = llmSelection(
    { ...settings, assistantProvider: "openai" },
    "chat",
  ).connectionId;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const maxBytes = 1024 * 1024;
  let models: { id: string; name: string }[];
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error("Model catalogue unavailable");
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw new Error("Model catalogue too large");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error("Model catalogue too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data))
      throw new Error("Invalid model catalogue");
    models = [];
    const seen = new Set<string>();
    for (const item of body.data) {
      if (!item || typeof item !== "object" || typeof item.id !== "string") continue;
      const id = item.id.trim();
      if (!id || id.length > 200 || seen.has(id)) continue;
      seen.add(id);
      const name = typeof item.name === "string" ? item.name.trim().slice(0, 200) : "";
      models.push({ id, name: name || id });
      if (models.length === 5000) break;
    }
  } catch {
    throw new AppError(
      502,
      "Не удалось загрузить список моделей. Проверьте адрес API, ключ и поддержку /models. Название модели можно ввести вручную.",
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  const current = store.settings();
  if (
    snapshot !==
    JSON.stringify([current.openaiBaseUrl, current.openaiWireApi, store.secret("openai.apiKey")])
  )
    throw new AppError(409, "Подключение API изменилось. Загрузите список моделей заново.");
  return { models, connectionId };
}
