import { useOpenaiModels } from "../model/useOpenaiModels.js";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import { api } from "../../../shared/api/http/index.js";
import { useLatestCallback } from "../../../shared/lib/latest-callback/index.js";

type ModelConnection = {
  provider: "copilot" | "openai";
  model: string;
  models: { id: string; name?: string }[];
  connectionId: string;
};

export function ModelOverride({
  value,
  onChange,
  disabled = false,
  purpose = "chat",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  purpose?: "chat" | "review";
}) {
  const catalog = useOpenaiModels();
  const catalogId = useId();
  const resetCatalog = catalog.reset;
  const [connection, setConnection] = useState<ModelConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const connectionId = useRef<string | null>(null);
  const settingsSignature = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const change = useLatestCallback(onChange);
  const load = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await api<ModelConnection>(
        `/llm/models?purpose=${purpose}`,
        "GET",
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (connectionId.current !== null && connectionId.current !== result.connectionId) change("");
      connectionId.current = result.connectionId;
      setConnection(result);
    } catch {
      if (!controller.signal.aborted) setError("Не удалось загрузить модели. Повторите загрузку.");
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setLoading(false);
      }
    }
  }, [purpose, change]);
  useEffect(() => {
    void load();
    const refresh = (event: Event) => {
      const settings = (event as CustomEvent).detail;
      const provider =
        settings[purpose === "chat" ? "assistantProvider" : "reviewProvider"] || "copilot";
      const signature = JSON.stringify(
        provider === "openai"
          ? [
              provider,
              settings.openaiBaseUrl,
              settings.openaiWireApi,
              settings[purpose === "chat" ? "openaiModel" : "openaiReviewModel"],
            ]
          : [
              provider,
              settings.githubConnected,
              settings.model,
              purpose === "review" ? settings.reviewModel : "",
            ],
      );
      if (settingsSignature.current === signature) return;
      change("");
      resetCatalog();
      setConnection(null);
      settingsSignature.current = signature;
      void load();
    };
    window.addEventListener("orbit-llm-settings-changed", refresh);
    return () => {
      pending.current?.abort();
      window.removeEventListener("orbit-llm-settings-changed", refresh);
    };
  }, [load, purpose, change, resetCatalog]);
  return (
    <div className="model-override" data-provider={connection?.provider}>
      {connection?.provider === "openai" ? (
        <>
          <label>
            <span className="multi-select-label">Модель</span>
            <input
              aria-label="Модель внешнего API для этого запроса"
              title={`Модель внешнего API. Пустое поле — из настроек: ${connection.model}`}
              placeholder={connection.model || "Из настроек"}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              disabled={disabled || loading}
              autoComplete="off"
              list={catalogId}
            />
          </label>
          <datalist id={catalogId}>
            {catalog.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name || model.id}
              </option>
            ))}
          </datalist>
          <button
            type="button"
            className="text-button"
            disabled={disabled || catalog.loading}
            onClick={() => void catalog.load()}
          >
            {catalog.loading ? "Загружаю список…" : "Загрузить модели"}
          </button>
          <small>
            Из сохранённого подключения. Можно выбрать подсказку или ввести любое имя модели.
          </small>
          {catalog.message && <small role="status">{catalog.message}</small>}
        </>
      ) : (
        <SingleSelect
          label="Модель"
          value={value}
          onChange={onChange}
          disabled={disabled || loading || !connection}
          onSearch={() => {
            if (!connection && !pending.current) void load();
          }}
          options={[
            { value: "", label: "Из настроек" },
            ...(value && !connection?.models.some((m) => m.id === value)
              ? [{ value, label: value }]
              : []),
            ...(connection?.models || []).map((m) => ({ value: m.id, label: m.name || m.id })),
          ]}
        />
      )}
      {loading && <small role="status">Загружаю модели…</small>}
      {error && (
        <small role="status">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            disabled={disabled || loading}
            onClick={() => void load()}
          >
            Повторить
          </button>
        </small>
      )}
    </div>
  );
}
