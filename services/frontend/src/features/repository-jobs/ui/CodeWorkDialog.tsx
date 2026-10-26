import { useEffect, useRef, useState } from "react";
import { Bug, X, Square, LoaderCircle } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { CodeProgress } from "./CodeProgress.js";

type Job = {
  id: string;
  operation: string;
  branch: string;
  running: boolean;
  stage: string;
  startedAt: number;
  updatedAt?: number;
  queuePosition: number;
  percent?: number;
};
const operations: Record<string, string> = {
  pull: "Загрузка ветки",
  status: "Проверка ветки",
  branches: "Список веток",
  tree: "Дерево файлов",
  file: "Чтение файла",
  search: "Поиск",
};
export function CodeWorkDialog({
  context,
  onClose,
}: {
  context: { client: string; project: string };
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  const [cancelling, setCancelling] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await api<{ jobs: Job[] }>(
          "/code-browser",
          "POST",
          { client: context.client, project: context.project, operation: "jobs", localOnly: true },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setJobs(result.jobs);
          setLoaded(true);
          setError("");
        }
      } catch (e: any) {
        if (!controller.signal.aborted) setError(e.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 2000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [context.client, context.project, revision]);
  return (
    <dialog
      ref={dialog}
      className="developer-dialog code-work-dialog"
      onCancel={onClose}
      onClose={onClose}
      aria-label="Текущая работа Git"
    >
      <div className="developer-dialog-heading">
        <h2>
          <Bug size={18} />
          Текущая работа Git
        </h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        {context.client} / {context.project} · обновление каждые 2 секунды. Отмена прервёт выбранную
        задачу и все ожидающие её запросы, в том числе от чата или ревью.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loaded && !error && (
        <p>
          <LoaderCircle size={16} className="spin" />
          Получаю состояние…
        </p>
      )}
      {loaded && !jobs.length && !error && (
        <p className="code-work-empty">Активных задач и задач в очереди нет.</p>
      )}
      <div className="code-work-list">
        {jobs.map((job) => (
          <section className="code-work-job" key={job.id}>
            <div className="code-work-job-heading">
              <strong>{operations[job.operation] || job.operation}</strong>
              <span>
                {job.running ? "В работе" : `В очереди · позиция ${job.queuePosition + 1}`}
              </span>
              <button
                type="button"
                className="secondary code-work-cancel"
                disabled={!!cancelling}
                onClick={async () => {
                  setCancelling(job.id);
                  setError("");
                  try {
                    await api("/code-browser", "POST", {
                      client: context.client,
                      project: context.project,
                      operation: "cancel",
                      jobId: job.id,
                      localOnly: true,
                    });
                    setRevision((value) => value + 1);
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setCancelling("");
                  }
                }}
              >
                <Square size={13} />
                {cancelling === job.id ? "Отменяю…" : "Отменить задачу"}
              </button>
            </div>
            <code className="code-work-branch">{job.branch || "Все ветки"}</code>
            <CodeProgress progress={{ ...job, started: job.startedAt }} />
            <details>
              <summary>Технические данные</summary>
              <pre>{JSON.stringify(job, null, 2)}</pre>
            </details>
          </section>
        ))}
      </div>
    </dialog>
  );
}
