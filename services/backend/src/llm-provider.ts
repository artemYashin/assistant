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
      "Подключение модели изменилось. Верните прежний провайдер и адрес API для продолжения или создайте новый чат / запустите новое ревью. История сохранена.",
    );
}
