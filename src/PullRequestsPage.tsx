import { useEffect, useState } from "react";
import { api } from "./api.js";
const status: Record<string, string> = {
  queued: "В очереди",
  running: "Ревью выполняется",
  completed: "Ревью готово",
  error: "Ошибка — автоповтор отключён",
  interrupted: "Прервано — автоповтор отключён",
  outdated: "Версия устарела",
};
export function PullRequestsPage({
  context,
  settings,
}: {
  context: { client: string; project: string };
  settings: any;
}) {
  const [monitors, setMonitors] = useState<any[]>([]),
    [prs, setPrs] = useState<any[]>([]),
    [azureProject, setAzureProject] = useState(""),
    [all, setAll] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const query = new URLSearchParams(context).toString();
  async function load() {
    const [m, p] = await Promise.all([
      api("/pr/projects"),
      api(`/pr?${query}`),
    ]);
    setMonitors(m);
    setPrs(p);
  }
  useEffect(() => {
    let live = true;
    setPrs([]);
    const tick = async () => {
      try {
        const [m, p] = await Promise.all([
          api("/pr/projects"),
          api(`/pr?${query}`),
        ]);
        if (live) {
          setMonitors(m);
          setPrs(p);
        }
      } catch (e: any) {
        if (live) setError(e.message);
      }
    };
    void tick();
    const timer = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [query]);
  async function run(fn: () => Promise<any>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      setNotice("Сохранено. Список обновится при синхронизации.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const selected = monitors.filter(
    (m) =>
      (!context.client || m.client === context.client) &&
      (!context.project || m.project === context.project),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Pull requests</h1>
          <p>
            Azure DevOps · изменения и автоматическое ревью в выбранном
            контексте.
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
      {notice && <p role="status">{notice}</p>}
      <div className="panel" style={{ padding: 20, marginBottom: 20 }}>
        <h2>Мониторинг проекта</h2>
        <p className="muted">
          Опрос каждые {(settings?.syncSeconds || 600) / 60} минут после
          предыдущего прохода. Новые версии PR автоматически отправляются в
          Copilot; до {settings?.prDailyLimit || 20} попыток ревью за 24 часа на
          все проекты. Ответы остаются в Orbit, комментарии и голоса в Azure не
          отправляются.
        </p>
        {!context.project ? (
          <p>
            Выберите заказчика и проект сверху, чтобы подключить мониторинг.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                api("/pr/projects", "POST", {
                  ...context,
                  azure_project: azureProject.trim(),
                  mode: all ? "all" : "required",
                  enabled: true,
                }),
              );
            }}
          >
            <label>
              Проект в Azure DevOps
              <input
                required
                maxLength={200}
                placeholder={settings?.azureProject || "Название проекта Azure"}
                value={azureProject}
                onChange={(e) => setAzureProject(e.target.value)}
              />
            </label>
            <label style={{ display: "block", margin: "12px 0" }}>
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => setAll(e.target.checked)}
              />{" "}
              Показывать все активные PR проекта
            </label>
            <p className="muted">
              Без галочки — только PR, где владелец PAT лично указан как
              required reviewer. Назначение через группу пока не учитывается.
              Используются URL коллекции и PAT из настроек; PAT нужен Code:
              Read.
            </p>
            <button className="primary" disabled={busy || !azureProject.trim()}>
              Подключить автоматическое ревью
            </button>
          </form>
        )}
        {selected.map((m) => (
          <div
            key={m.id}
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 12,
              marginTop: 12,
            }}
          >
            <b>
              {m.client} / {m.project} → {m.azure_project}
            </b>
            <p className="muted">
              {m.source} ·{" "}
              {m.synced_at
                ? new Date(m.synced_at).toLocaleString("ru-RU")
                : "Ещё не синхронизирован"}
            </p>
            <label>
              <input
                type="checkbox"
                disabled={busy}
                checked={m.mode === "all"}
                onChange={(e) =>
                  void run(() =>
                    api(`/pr/projects/${m.id}`, "PUT", {
                      mode: e.target.checked ? "all" : "required",
                      enabled: !!m.enabled,
                    }),
                  )
                }
              />{" "}
              Все PR
            </label>
            <label style={{ marginLeft: 20 }}>
              <input
                type="checkbox"
                disabled={busy}
                checked={!!m.enabled}
                onChange={(e) =>
                  void run(() =>
                    api(`/pr/projects/${m.id}`, "PUT", {
                      mode: m.mode,
                      enabled: e.target.checked,
                    }),
                  )
                }
              />{" "}
              Мониторинг включён
            </label>
            {m.error && <p className="error">{m.error}</p>}
          </div>
        ))}
      </div>
      {!prs.length ? (
        <div className="empty">
          <h3>Pull request’ов пока нет</h3>
          <p>
            Подключите проект и запустите синхронизацию. При первом подключении
            существующие активные PR тоже попадут в очередь.
          </p>
        </div>
      ) : (
        <div className="card-list">
          {prs.map((p) => {
            const coverage = p.coverage ? JSON.parse(p.coverage) : null;
            return (
              <article
                className="panel"
                style={{ padding: 20 }}
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
                      : status[p.review_status] || "Ожидает версии коммитов"}
                  </span>
                </div>
                <p className="muted">
                  {p.client} / {p.project} · {p.azure_project} · {p.author}
                </p>
                <small>
                  Версия {p.head.slice(0, 10)} → {p.target.slice(0, 10)}
                </small>
                {!p.in_scope && (
                  <p className="muted">
                    PR больше не входит в текущую выборку: закрыт, переназначен
                    или фильтр изменён.
                  </p>
                )}
                {!p.enabled && <p className="muted">Мониторинг отключён.</p>}
                {p.error && <p className="error">{p.error}</p>}
                {coverage && (
                  <p className="muted">
                    Текстовых diff: {coverage.files}.{" "}
                    {coverage.notes.length
                      ? `Неполная проверка: ${coverage.notes.join("; ")}`
                      : "Все возвращённые текстовые изменения включены. Тесты не запускались."}
                  </p>
                )}
                {p.summary && (
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                      lineHeight: 1.65,
                    }}
                  >
                    {p.summary}
                  </pre>
                )}
                {p.usage_id && (
                  <small>
                    ID запроса LLM: {p.usage_id} · расход в разделе
                    «Использование LLM»
                  </small>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
