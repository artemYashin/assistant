import { useCallback, useEffect, useRef, useState } from "react";
import { apiProgress } from "./api.js";

const labels: Record<string, string> = {
  recovering: "Восстановление после прерванной загрузки",
  connecting: "Подключение к репозиторию", queued: "Ожидание очереди", preparing: "Подготовка кеша",
  fetching: "Получение Git-данных", counting: "Подсчёт объектов", compressing: "Сжатие объектов",
  receiving: "Скачивание объектов", resolving: "Обработка изменений", unpacking: "Распаковка объектов",
  finalizing: "Сохранение снимка", tree: "Чтение дерева файлов", file: "Чтение файла",
  snapshot: "Подготовка файлов для поиска", searching: "Поиск", done: "Готово", error: "Операция не завершена",
};
type Progress = { stage: string; percent?: number; started: number; ended?: number; operation: string; queuePosition?: number; queueLength?: number };
export function useCodeProgress() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const sequence = useRef(0), controllers = useRef(new Set<AbortController>());
  useEffect(() => () => { sequence.current++; for (const controller of controllers.current) controller.abort(); controllers.current.clear(); }, []);
  const execute = useCallback(async (body: Record<string, unknown>) => {
    const id = ++sequence.current, operation = String(body.operation);
    let started = Date.now();
    const controller = new AbortController(); controllers.current.add(controller);
    setProgress({ stage: "connecting", started, operation });
    try {
      const result = await apiProgress("/code-browser", body, value => {
        if (id !== sequence.current || !value || !labels[value.stage]) return;
        const percent = Number.isInteger(value.percent) && value.percent! >= 0 && value.percent! <= 100 ? value.percent : undefined;
        if (value.startedAt && Number.isFinite(value.startedAt)) started = value.startedAt;
        setProgress({ stage: value.stage, percent, started, operation, queuePosition: value.queuePosition, queueLength: value.queueLength });
      }, controller.signal);
      if (id === sequence.current) setProgress({ stage: "done", started, ended: Date.now(), operation });
      return result;
    } catch (error) {
      if (id === sequence.current) setProgress({ stage: "error", started, ended: Date.now(), operation });
      throw error;
    } finally { controllers.current.delete(controller); }
  }, []);
  return { progress, execute };
}
export function CodeProgress({ progress }: { progress: Progress | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!progress || progress.ended) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [progress?.started, progress?.ended]);
  if (!progress) return null;
  const seconds = Math.max(0, Math.floor(((progress.ended || now) - progress.started) / 1000));
  const elapsed = seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
  return <div className={`repository-progress${progress.stage === "error" ? " is-error" : ""}`}>
    <div><span role="status">{labels[progress.stage]}</span><small>{progress.percent !== undefined && !progress.ended ? `${progress.percent}% · ` : ""}{elapsed}</small></div>
    {!progress.ended && <progress aria-label={labels[progress.stage]} max={100} value={progress.percent} />}
    {!progress.ended && !!progress.queueLength && <div className="repository-queue" aria-label="Очередь операций">
      {Array.from({ length: progress.queueLength }, (_, index) => <span key={index} className={index === progress.queuePosition ? "is-current" : ""}>
        {index === 0 ? "В работе" : `Очередь №${index}`}{index === progress.queuePosition ? " · вы" : ""}
      </span>)}
    </div>}
  </div>;
}
