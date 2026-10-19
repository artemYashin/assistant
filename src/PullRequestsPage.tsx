import { useEffect, useState } from "react";
import { api } from "./api.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { StatusBadge } from "./TicketControls.js";
const statuses: Record<string, string> = {
  queued: "В очереди по вашему запросу",
  running: "Ревью выполняется",
  completed: "Ревью готово",
  error: "Ошибка",
  interrupted: "Прервано",
  outdated: "Версия устарела",
  cancelled: "Отменено",
};
function PrDescription({ pr }: any) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="pr-content-section"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Описание pull request</summary>
      {open &&
        (pr.description ? (
          <ChatMarkdown text={pr.description} images={pr.images} />
        ) : (
          <p className="muted">Описание не указано.</p>
        ))}
    </details>
  );
}
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
    <details
      className="pr-history"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Сохранённые ревью всех версий</summary>
      {error && <p className="error">{error}</p>}
      {!items.length && <p className="muted">Ревью ещё не запускалось.</p>}
      {items.map((r) => (
        <section className="pr-review-result" key={r.id}>
          <h3>Ревью версии {r.head.slice(0, 10)}</h3>
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
          PR пока нет. Укажите Git-репозиторий через «Заказчики и проекты»
          сверху и запустите синхронизацию.
        </div>
      )}
      <div className="card-list">
        {prs.map((p) => (
          <article
            className="panel pr-review"
            key={`${p.monitor}:${p.repo}:${p.number}`}
          >
            <div className="section-heading">
              <h2 className="pr-title">
                <span className="pr-kind-badge">PR</span>
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
            <div className="pr-author">
              <span className="pr-avatar" aria-hidden="true">
                {(p.author || "?").slice(0, 1).toUpperCase()}
              </span>
              <div>
                <small>Автор</small>
                <strong>{p.author || "Не указан"}</strong>
              </div>
            </div>
            <div className="pr-context-badges">
              <span className="pr-context-badge">
                <small>Заказчик</small>
                {p.client || "—"}
              </span>
              <span className="pr-context-badge">
                <small>Проект Orbit</small>
                {p.project || "—"}
              </span>
              <span className="pr-context-badge">
                <small>Azure Project</small>
                {p.azure_project}
              </span>
              {p.in_scope && p.repository && (
                <span className="pr-context-badge">
                  <small>Репозиторий</small>
                  {p.repository}
                </span>
              )}
            </div>
            <PrDescription pr={p} />
            <details className="pr-content-section">
              <summary>Тикеты из описания · {p.tickets?.length || 0}</summary>
              <p className="muted">
                Упоминание в PR не означает закрытие тикета. Здесь показан
                последний синхронизированный статус Azure.
              </p>
              {p.ticket_error && <p className="error">{p.ticket_error}</p>}
              {!p.tickets?.length && (
                <p className="muted">Номеров вида #123456 в описании нет.</p>
              )}
              <div className="pr-ticket-list">
                {(p.tickets || []).map((t: any) => (
                  <div className="pr-ticket-row" key={t.id}>
                    <strong>
                      #{t.id}
                      {t.title ? ` · ${t.title}` : ""}
                    </strong>
                    {t.unavailable ? (
                      <span className="muted">
                        {t.removed
                          ? "Удалён из локального списка"
                          : "Не загружен: проверьте доступ, существование и проект тикета"}
                      </span>
                    ) : (
                      <div className="pr-context-badges">
                        <StatusBadge
                          state={t.type}
                          kind="type"
                          colors={settings?.typeColors}
                        />
                        <StatusBadge
                          state={t.state}
                          colors={settings?.statusColors}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </details>
            <details className="pr-technical">
              <summary>Версия изменений и ID репозитория</summary>
              <dl>
                <div>
                  <dt>Source commit</dt>
                  <dd>
                    <code>{p.head}</code>
                  </dd>
                </div>
                <div>
                  <dt>Target commit</dt>
                  <dd>
                    <code>{p.target}</code>
                  </dd>
                </div>
                <div>
                  <dt>ID репозитория</dt>
                  <dd>
                    <code>{p.repo}</code>
                  </dd>
                </div>
              </dl>
            </details>
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
            {p.summary && (
              <section className="pr-review-result">
                <div className="section-heading">
                  <h3>Результат ревью</h3>
                  <span className="badge">
                    {statuses[p.review_status] || "Сохранено"}
                  </span>
                </div>
                {p.finished_at && (
                  <small>
                    {new Date(p.finished_at).toLocaleString("ru-RU")}
                  </small>
                )}
                <ChatMarkdown text={p.summary} />
              </section>
            )}
            <ReviewHistory pr={p} />
          </article>
        ))}
      </div>
    </>
  );
}
