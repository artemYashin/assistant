import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../shared/api/http/index.js";

type OpenaiModel = { id: string; name?: string };

/** Explicit discovery only: never sends a request until the user asks. */
export function useOpenaiModels() {
  const [models, setModels] = useState<OpenaiModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const savedSignature = useRef<string | null>(null);
  const reset = useCallback(() => {
    savedSignature.current = null;
    pending.current?.abort();
    pending.current = null;
    setModels([]);
    setLoading(false);
    setMessage("");
  }, []);
  useEffect(() => {
    mounted.current = true;
    const refresh = (event: Event) => {
      const settings = (event as CustomEvent).detail;
      const signature = JSON.stringify([
        settings.openaiBaseUrl,
        settings.openaiWireApi,
        settings.openaiApiKeySet,
      ]);
      if (savedSignature.current !== null && savedSignature.current !== signature) reset();
      savedSignature.current = signature;
    };
    window.addEventListener("orbit-openai-catalog-invalidated", reset);
    window.addEventListener("orbit-settings-saved", reset);
    window.addEventListener("orbit-llm-settings-changed", refresh);
    return () => {
      mounted.current = false;
      pending.current?.abort();
      window.removeEventListener("orbit-openai-catalog-invalidated", reset);
      window.removeEventListener("orbit-settings-saved", reset);
      window.removeEventListener("orbit-llm-settings-changed", refresh);
    };
  }, [reset]);
  const load = useCallback(async () => {
    if (!mounted.current) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setMessage("");
    try {
      const result = await api<{ models: OpenaiModel[]; connectionId: string }>(
        "/llm/openai-models",
        "GET",
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setModels(result.models);
      setMessage(
        result.models.length
          ? "Список загружен. Выберите подсказку или введите другой идентификатор."
          : "Провайдер вернул пустой список. Введите идентификатор вручную.",
      );
    } catch {
      if (!controller.signal.aborted) {
        setModels([]);
        setMessage(
          "Не удалось загрузить список моделей. Введите идентификатор вручную или повторите загрузку.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setLoading(false);
      }
    }
  }, []);
  return { models, loading, message, load, reset };
}
