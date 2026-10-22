import { PullRequestsPage } from "./PullRequestsPage.js";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { api } from "./api.js";
import { SingleSelect } from "./SingleSelect.js";
export function CompletedPullRequests({
  context,
  settings,
}: {
  settings?: any;
  context: { client: string; project: string };
}) {
  const [monitors, setMonitors] = useState<any[]>([]),
    [monitor, setMonitor] = useState("");
  const [page, setPage] = useState(0),
    [version, setVersion] = useState(0);
  const [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api("/pr/projects")
      .then((rows) => {
        if (!live) return;
        const filtered = rows.filter(
          (m: any) =>
            (!context.client || m.client === context.client) &&
            (!context.project || m.project === context.project),
        );
        setMonitors(filtered);
        setMonitor(filtered[0]?.id || "");
        setBusy(false);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setBusy(false);
        }
      });
    return () => {
      live = false;
    };
  }, [context.client, context.project]);
  useEffect(() => {
    if (!monitor) return;
    let live = true;
    setBusy(true);
    setError("");
    setData(null);
    api(`/pr/completed?${new URLSearchParams({ monitor, page: String(page) })}`)
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [monitor, page, version]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Завершённые PR</h1>
          <p>Смёрженные за последние 7 дней · по 20 на странице.</p>
        </div>
      </div>
      <div className="completed-pr-controls">
        <SingleSelect
          label="Репозиторий"
          value={monitor}
          options={monitors.map((m) => ({
            value: m.id,
            label: `${m.client} / ${m.project} · ${m.repository}`,
          }))}
          onChange={(v) => {
            setMonitor(v);
            setPage(0);
          }}
          disabled={busy}
        />
        <button
          className="secondary"
          disabled={busy || !monitor}
          onClick={() => setVersion((v) => v + 1)}
        >
          <RefreshCw size={15} />
          Обновить
        </button>
      </div>
      <p className="muted">
        Список загружается из Azure. Описание и связи хранятся локально неделю после
        завершения PR; полное описание из импорта сохраняется. Фильтры ревьюеров здесь не применяются.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Загрузка…</p>}
      {!busy && !monitor && !error && (
        <p>Настройте репозиторий в разделе «Заказчики и проекты».</p>
      )}
      {data && (
        <>
          <nav
            className="completed-pr-pagination"
            aria-label="Страницы завершённых PR"
          >
            <button
              className="secondary"
              disabled={busy || page === 0}
              onClick={() => setPage((v) => v - 1)}
            >
              <ChevronLeft size={16} />
              Назад
            </button>
            <span>Страница {page + 1}</span>
            <button
              className="secondary"
              disabled={busy || !data.hasNext}
              onClick={() => setPage((v) => v + 1)}
            >
              Далее
              <ChevronRight size={16} />
            </button>
          </nav>
          {!data.items.length && <p>На этой странице завершённых PR нет.</p>}
          <PullRequestsPage
            context={context}
            settings={settings}
            completedItems={data.items}
          />
        </>
      )}
    </>
  );
}
