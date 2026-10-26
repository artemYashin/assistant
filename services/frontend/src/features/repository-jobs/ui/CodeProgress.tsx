import { useCallback, useEffect, useRef, useState } from "react";
import { apiProgress } from "../../../shared/api/http/index.js";

const labels: Record<string, string> = {
  cancelled: "Операция отменена",
  recovering: "Восстановление после прерванной загрузки",
  connecting: "Подключение к репозиторию",
  queued: "Ожидание очереди",
  preparing: "Подготовка кеша",
  fetching: "Получение Git-данных",
  counting: "Подсчёт объектов",
  compressing: "Сжатие объектов",
  receiving: "Скачивание объектов",
  resolving: "Обработка изменений",
  unpacking: "Распаковка объектов",
  finalizing: "Сохранение снимка",
  tree: "Чтение дерева файлов",
  file: "Чтение файла",
  snapshot: "Подготовка файлов для поиска",
  searching: "Поиск",
  done: "Готово",
  error: "Операция не завершена",
};
type Progress = {
  stage: string;
  percent?: number;
  started: number;
  ended?: number;
  operation: string;
  queuePosition?: number;
  queueLength?: number;
  updatedAt?: number;
  receivedBytes?: number;
  bytesPerSecond?: number;
  receivedObjects?: number;
  totalObjects?: number;
};
export function useCodeProgress() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const sequence = useRef(0),
    controllers = useRef(new Set<AbortController>());
  useEffect(
    () => () => {
      sequence.current++;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    },
    [],
  );
  const execute = useCallback(async (body: Record<string, unknown>) => {
    const id = ++sequence.current,
      operation = String(body.operation);
    let started = Date.now();
    const controller = new AbortController();
    controllers.current.add(controller);
    setProgress({ stage: "connecting", started, operation });
    try {
      const result = await apiProgress(
        "/code-browser",
        body,
        (value) => {
          if (id !== sequence.current || !value || !labels[value.stage]) return;
          const percent =
            Number.isInteger(value.percent) && value.percent! >= 0 && value.percent! <= 100
              ? value.percent
              : undefined;
          if (value.startedAt && Number.isFinite(value.startedAt)) started = value.startedAt;
          setProgress({
            stage: value.stage,
            percent,
            started,
            operation,
            queuePosition: value.queuePosition,
            queueLength: value.queueLength,
            updatedAt: value.updatedAt,
            receivedBytes: value.receivedBytes,
            bytesPerSecond: value.bytesPerSecond,
            receivedObjects: value.receivedObjects,
            totalObjects: value.totalObjects,
          });
        },
        controller.signal,
      );
      if (id === sequence.current)
        setProgress((previous) => ({
          ...previous,
          stage: "done",
          started,
          ended: Date.now(),
          operation,
        }));
      return result;
    } catch (error) {
      if (id === sequence.current)
        setProgress((previous) => ({
          ...previous,
          stage: "error",
          started,
          ended: Date.now(),
          operation,
        }));
      throw error;
    } finally {
      controllers.current.delete(controller);
    }
  }, []);
  const stop = useCallback(() => {
    sequence.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    setProgress((previous) =>
      previous ? { ...previous, stage: "cancelled", ended: Date.now() } : null,
    );
  }, []);
  return { progress, execute, stop };
}
function formatBytes(value: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = Math.min(4, Math.max(0, Math.floor(Math.log(Math.max(1, value)) / Math.log(1024))));
  return `${(value / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}
export function CodeProgress({ progress }: { progress: Progress | null }) {
  const started = progress?.started,
    ended = progress?.ended;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!started || ended) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [started, ended]);
  if (!progress) return null;
  const seconds = Math.max(0, Math.floor(((progress.ended || now) - progress.started) / 1000));
  const elapsed =
    seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
  const silence = Math.max(0, Math.floor((now - (progress.updatedAt || progress.started)) / 1000));
  return (
    <div className={`repository-progress${progress.stage === "error" ? " is-error" : ""}`}>
      <div>
        <span role="status">{labels[progress.stage]}</span>
        <small>
          {progress.percent !== undefined && !progress.ended ? `${progress.percent}% · ` : ""}
          {elapsed}
        </small>
      </div>
      {progress.receivedBytes !== undefined && (
        <div className="repository-transfer">
          <span>
            Получено <strong>{formatBytes(progress.receivedBytes)}</strong>
          </span>
          {!progress.ended &&
            progress.stage === "receiving" &&
            progress.bytesPerSecond !== undefined &&
            silence < 15 && <span>{formatBytes(progress.bytesPerSecond)}/с</span>}
          {progress.totalObjects !== undefined && (
            <span title="Git сообщает общее число объектов, но не размер загрузки заранее">
              {progress.receivedObjects?.toLocaleString()} /{" "}
              {progress.totalObjects.toLocaleString()} объектов
            </span>
          )}
        </div>
      )}
      {!progress.ended && progress.stage !== "queued" && silence >= 15 && (
        <small className="repository-progress-stale" role="status">
          Нет нового прогресса {silence} с · возможно ожидание сети или сна компьютера
        </small>
      )}
      {!progress.ended && (
        <progress aria-label={labels[progress.stage]} max={100} value={progress.percent} />
      )}
      {!progress.ended && !!progress.queueLength && (
        <div className="repository-queue" aria-label="Очередь операций">
          {Array.from({ length: progress.queueLength }, (_, index) => (
            <span key={index} className={index === progress.queuePosition ? "is-current" : ""}>
              {index === 0 ? "В работе" : `Очередь №${index}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
