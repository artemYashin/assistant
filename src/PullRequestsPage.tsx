import { useEffect, useState } from "react";
import { api } from "./api.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { ProjectRepository } from "./ProjectRepository.js";
const statuses: Record<string, string> = {
  queued: "В очереди по вашему запросу",
  running: "Ревью выполняется",
  completed: "Ревью готово",
  error: "Ошибка",
  interrupted: "Прервано",
  outdated: "Версия устарела",
  cancelled: "Отменено",
};
function ReviewHistory({ pr }: any) {
  const [items, setItems] = useState<any[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    api(
      `/pr/reviews?${new URLSearchParams({ monitor: pr.monitor, repo: pr.repo, number: String(pr.number) })}`,
    )
      .then((v) => {
        if (live) setItems(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [open, pr.review_status]);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Сохранённые ревью всех версий</summary>
      {error && <p className="error">{error}</p>}
      {!items.length && <p className="muted">Ревью ещё не запускалось.</p>}
      {items.map((r) => (
        <section className="pr-monitor" key={r.id}>
          <small>
            {new Date(r.created_at).toLocaleString("ru-RU")} ·{" "}
            {r.head.slice(0, 10)} → {r.target.slice(0, 10)} ·{" "}
            {statuses[r.status]}
          </small>
          {r.summary && <ChatMarkdown text={r.summary} />}
          {r.error && <p className="error">{r.error}</p>}
        </section>
      ))}
    </details>
  );
}
export function PullRequestsPage({ context, settings }: any) {
  const [prs, setPrs] = useState<any[]>([]),
    [monitors, setMonitors] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const query = new URLSearchParams(context).toString();
  useEffect(() => {
    let live = true;
    const load = () =>
      Promise.all([api(`/pr?${query}`), api("/pr/projects")])
        .then(([p, m]) => {
          if (live) {
            setPrs(p);
            setMonitors(m);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    setPrs([]);
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [query, version]);
  async function run(fn: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Pull requests</h1>
          <p>
            Синхронизация каждые {(settings?.syncSeconds || 600) / 60} минут.
            Ревью запускается только вашей кнопкой.
          </p>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void run(() => api("/sync", "POST", {}))}
        >
          Синхронизировать сейчас
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="panel">
        <ProjectRepository
          context={context}
          onSaved={() => setVersion((v) => v + 1)}
        />
      </div>
      {monitors
        .filter(
          (m) => m.client === context.client && m.project === context.project,
        )
        .map((m) => (
          <p className="muted" key={m.id}>
            {m.azure_project} / {m.repository || "Репозиторий не выбран"} ·{" "}
            {m.enabled ? "Опрос включён" : "Опрос выключен"}
            {m.error ? ` · ${m.error}` : ""}
          </p>
        ))}
      <p className="muted">
        Ревью учитывает общую память, память заказчика и проекта; до{" "}
        {settings?.prDailyLimit || 20} запусков за 24 часа. Комментарии и голоса
        в Azure не отправляются.
      </p>
      {!prs.length && (
        <div className="empty">
          PR пока нет. Настройте репозиторий и запустите синхронизацию.
        </div>
      )}
      <div className="card-list">
        {prs.map((p) => (
          <article
            className="panel pr-review"
            key={`${p.monitor}:${p.repo}:${p.number}`}
          >
            <div className="section-heading">
              <h2>
                <a href={p.url} target="_blank" rel="noreferrer">
                  #{p.number} · {p.title}
                </a>
              </h2>
              <span className="badge">
                {p.draft
                  ? "Черновик"
                  : statuses[p.review_status] || "Ревью не запускалось"}
              </span>
            </div>
            <p className="muted">
              {p.client} / {p.project} · {p.azure_project} · repo {p.repo} ·{" "}
              {p.author}
            </p>
            <small>
              {p.head.slice(0, 10)} → {p.target.slice(0, 10)}
            </small>
            {!p.in_scope && (
              <p className="muted">
                PR вне текущей выборки. Сохранённые результаты доступны ниже.
              </p>
            )}
            <button
              className="secondary"
              disabled={
                busy ||
                !p.in_scope ||
                !p.enabled ||
                !!p.draft ||
                ["queued", "running", "completed"].includes(p.review_status)
              }
              onClick={() =>
                void run(() =>
                  api("/pr/review", "POST", {
                    monitor: p.monitor,
                    repo: p.repo,
                    number: p.number,
                  }),
                )
              }
            >
              {p.review_status === "completed"
                ? "Текущая версия проверена"
                : "Запустить ревью"}
            </button>
            {p.error && <p className="error">{p.error}</p>}
            {p.coverage && (
              <p className="muted">
                Покрытие: {JSON.parse(p.coverage).files} файлов.{" "}
                {JSON.parse(p.coverage).notes.join("; ")}
              </p>
            )}
            {p.summary && <ChatMarkdown text={p.summary} />}
            <ReviewHistory pr={p} />
          </article>
        ))}
      </div>
    </>
  );
}
