import { PrHealth } from "./PrHealth.js";
import { PrDiffDialog } from "./PrDiffDialog.js";
import { PrMergeDialog } from "./PrMergeDialog.js";
import { SingleSelect } from "./SingleSelect.js";
import {
  Code2,
  GitMerge,
  Copy,
  Check,
  FileText,
  History,
  FolderOpen,
  GitCommitHorizontal,
  Ticket,
  ClipboardCheck,
  Sparkles,
  Clock,
  MessageCircle,
  LoaderCircle,
} from "lucide-react";
import { filterPullRequests } from "./pr-filters.js";
import { Link, useLocation } from "react-router-dom";
import { ticketPath } from "./routing.js";
import { useEffect, useState, useRef } from "react";
import { api } from "./api.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { StatusBadge } from "./TicketControls.js";
const statuses: Record<string, string> = {
  awaiting_answers: "Нужны ответы",
  queued: "В очереди по вашему запросу",
  running: "Ревью выполняется",
  completed: "Ревью готово",
  error: "Ошибка",
  interrupted: "Прервано",
  outdated: "Версия устарела",
  cancelled: "Отменено",
};
function BranchLabel({
  kind,
  value,
}: {
  kind: "source" | "target";
  value?: string;
}) {
  const name = value?.replace(/^refs\/heads\//, "") || "";
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    setStatus("idle");
  }, [value]);
  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <span
      className="pr-branch"
      title={`${kind} branch: ${value || "пока не загружена"}`}
    >
      <small>{kind}</small>
      <span className="pr-branch-value">
        <code>{name || "—"}</code>
        <button
          type="button"
          className="text-button"
          disabled={!name}
          aria-label={`Скопировать ${kind} ветку ${name}`}
          title={
            status === "copied" ? "Скопировано" : "Скопировать название ветки"
          }
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(name);
              setStatus("copied");
            } catch {
              setStatus("error");
            }
          }}
        >
          {status === "copied" ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </span>
      <small role="status">
        {status === "copied"
          ? "Скопировано"
          : status === "error"
            ? "Не удалось скопировать"
            : ""}
      </small>
    </span>
  );
}

function PrDescription({ pr }: any) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="pr-content-section"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <FileText size={17} aria-hidden="true" />
        Описание pull request
      </summary>
      {open &&
        (pr.description ? (
          <ChatMarkdown text={pr.description} images={pr.images} />
        ) : (
          <p className="muted">Описание не указано.</p>
        ))}
      {open && !!pr.tickets?.length && (
        <div
          className="pr-ticket-navigation"
          aria-label="Переходы к тикетам из описания"
        >
          {pr.tickets.map((t: any) => (
            <Link key={t.id} to={ticketPath(t.id, pr.ticket_source)}>
              Перейти к тикету #{t.id}
            </Link>
          ))}
        </div>
      )}
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
      <summary>
        <History size={17} aria-hidden="true" />
        Сохранённые ревью всех версий
      </summary>
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
  const [merging, setMerging] = useState<any>(null);
  const [viewingDiff, setViewingDiff] = useState<any>(null);
  const [draftFilter, setDraftFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [sort, setSort] = useState("created:desc");
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const target = params.get("monitor")
    ? {
        monitor: params.get("monitor")!,
        repo: params.get("repo") || "",
        number: params.get("number") || "",
      }
    : null;
  const targetKey = target ? JSON.stringify(target) : "";
  const focused = useRef("");
  const focusRef = useRef<HTMLElement>(null);
  const [loaded, setLoaded] = useState(false);
  const visiblePrs = filterPullRequests(prs, {
    draft: target ? "all" : draftFilter,
    review: target ? "all" : reviewFilter,
    sort,
  });
  const query = new URLSearchParams(target || context).toString();
  const previousQuery = useRef<string | null>(null);
  useEffect(() => {
    if (!targetKey) {
      focused.current = "";
      return;
    }
    if (!loaded || !prs.length || focused.current === targetKey) return;
    const frame = requestAnimationFrame(() => {
      focusRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      focusRef.current?.focus({ preventScroll: true });
      focused.current = targetKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [targetKey, loaded, prs]);
  useEffect(() => {
    let live = true;
    const load = () =>
      Promise.all([api(`/pr?${query}`), api("/pr/projects")])
        .then(([p, m]) => {
          if (live) {
            setLoaded(true);
            setPrs(p);
            setMonitors(m);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    // Keep mounted cards during refreshes so the page height, scroll and
    // accordion state survive a review launch. Clear only on scope changes.
    if (previousQuery.current !== query) {
      previousQuery.current = query;
      setLoaded(false);
      setPrs([]);
    }
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
      {viewingDiff && (
        <PrDiffDialog pr={viewingDiff} onClose={() => setViewingDiff(null)} />
      )}
      {merging && (
        <PrMergeDialog
          pr={merging}
          moveTickets={merging.moveTickets}
          onClose={() => {
            setMerging(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
      <div className="page-heading">
        <div>
          <h1>Pull requests</h1>
          <p>
            Синхронизация каждые {(settings?.syncSeconds || 600) / 60} минут.
            Ревью запускается по вашей просьбе; после отправки всех ответов —
            повторяется.
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
      {target && (
        <p className="pr-focus-notice" role="status">
          {loaded && !prs.length
            ? "Этот PR не найден в локальной базе."
            : "Показан PR по ссылке из тикета. Фильтры временно не применяются."}{" "}
          <Link to="/pull-requests">Показать все PR текущего проекта</Link>
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
      <div className="ticket-filters">
        <SingleSelect
          label="Тип PR"
          value={draftFilter}
          onChange={setDraftFilter}
          disabled={!!target}
          options={[
            { value: "all", label: "Все PR" },
            { value: "draft", label: "Черновики" },
            { value: "published", label: "Не черновики" },
          ]}
        />
        <SingleSelect
          label="Готовность ревью"
          value={reviewFilter}
          onChange={setReviewFilter}
          disabled={!!target}
          options={[
            { value: "all", label: "Все состояния" },
            { value: "ready", label: "Ревью готово" },
            { value: "pending", label: "Ревью не готово" },
          ]}
        />
        <SingleSelect
          label="Сортировка PR"
          value={sort}
          onChange={setSort}
          options={[
            { value: "created:desc", label: "Созданы: сначала новые" },
            { value: "created:asc", label: "Созданы: сначала старые" },
            { value: "number:desc", label: "Номер: по убыванию" },
            { value: "number:asc", label: "Номер: по возрастанию" },
            { value: "title:asc", label: "Название: А–Я" },
          ]}
        />
        <button
          className="secondary"
          disabled={
            draftFilter === "all" &&
            reviewFilter === "all" &&
            sort === "created:desc"
          }
          onClick={() => {
            setDraftFilter("all");
            setReviewFilter("all");
            setSort("created:desc");
          }}
        >
          Сбросить фильтры
        </button>
      </div>
      <p className="muted" role="status">
        Показано {visiblePrs.length} из {prs.length}. «Ревью готово» — проверена
        текущая версия PR.
      </p>
      {!!prs.length && !visiblePrs.length && (
        <div className="empty">
          Нет PR по выбранным фильтрам. Измените условия или сбросьте фильтры.
        </div>
      )}
      {!prs.length && (
        <div className="empty">
          PR пока нет. Укажите Git-репозиторий через «Заказчики и проекты»
          сверху и запустите синхронизацию.
        </div>
      )}
      <div className="card-list">
        {visiblePrs.map((p) => (
          <article
            className={`panel pr-review${p.draft ? " pr-draft" : ""}${target ? " pr-focused" : ""}`}
            ref={target ? focusRef : undefined}
            tabIndex={target ? -1 : undefined}
            key={`${p.monitor}:${p.repo}:${p.number}`}
          >
            <div className="pr-card-toolbar">
              <div className="pr-card-labels">
                <span className="pr-kind-badge">PR</span>
                <span
                  className={`pr-review-status ${p.review_status === "completed" ? "is-ready" : ["error", "interrupted"].includes(p.review_status) ? "is-error" : ["running", "queued", "awaiting_answers"].includes(p.review_status) ? "is-pending" : "is-idle"}`}
                >
                  {statuses[p.review_status] || "Ревью не запускалось"}
                </span>
                {!!p.draft && <span className="badge">Черновик</span>}
              </div>
              <div className="pr-card-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setViewingDiff(p)}
                >
                  <Code2 size={17} aria-hidden="true" /> View Diff
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !p.in_scope || !p.enabled || !!p.draft}
                  onClick={() => setMerging({ ...p, moveTickets: false })}
                >
                  <GitMerge size={17} aria-hidden="true" /> Merge
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !p.in_scope || !p.enabled || !!p.draft}
                  onClick={() => setMerging({ ...p, moveTickets: true })}
                >
                  <GitMerge size={17} aria-hidden="true" /> Merge и смена
                  статусов
                </button>
                <button
                  className="pr-review-launch"
                  disabled={
                    busy ||
                    !p.in_scope ||
                    !p.enabled ||
                    !!p.draft ||
                    [
                      "queued",
                      "running",
                      "completed",
                      "awaiting_answers",
                    ].includes(p.review_status)
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
                  {p.review_status === "completed" ? (
                    <Check size={17} aria-hidden="true" />
                  ) : p.review_status === "running" ? (
                    <LoaderCircle
                      className="spin"
                      size={17}
                      aria-hidden="true"
                    />
                  ) : p.review_status === "queued" ? (
                    <Clock size={17} aria-hidden="true" />
                  ) : p.review_status === "awaiting_answers" ? (
                    <MessageCircle size={17} aria-hidden="true" />
                  ) : (
                    <Sparkles size={17} aria-hidden="true" />
                  )}
                  {p.review_status === "completed"
                    ? "Текущая версия проверена"
                    : p.review_status === "awaiting_answers"
                      ? "Ожидает ответов"
                      : p.review_status === "running"
                        ? "Ревью выполняется"
                        : p.review_status === "queued"
                          ? "Ревью в очереди"
                          : "Запустить ревью"}
                </button>
                <details className="pr-technical pr-version-menu pr-context-menu">
                  <summary title="Заказчик, проекты и репозиторий">
                    <FolderOpen size={17} aria-hidden="true" />
                    Контекст
                  </summary>
                  <dl>
                    <div>
                      <dt>Заказчик</dt>
                      <dd>{p.client || "—"}</dd>
                    </div>
                    <div>
                      <dt>Проект Orbit</dt>
                      <dd>{p.project || "—"}</dd>
                    </div>
                    <div>
                      <dt>Azure Project</dt>
                      <dd>{p.azure_project || "—"}</dd>
                    </div>
                    <div>
                      <dt>Репозиторий</dt>
                      <dd>
                        {p.in_scope && p.repository
                          ? p.repository
                          : p.repo || "—"}
                      </dd>
                    </div>
                  </dl>
                </details>
                <details className="pr-technical pr-version-menu">
                  <summary title="Версия изменений и ID репозитория">
                    <GitCommitHorizontal size={17} aria-hidden="true" />
                    Версия изменений
                  </summary>
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
              </div>
            </div>
            <h2 className="pr-title">
              <a href={p.url} target="_blank" rel="noreferrer">
                #{p.number} · {p.title}
              </a>
            </h2>
            <PrHealth value={p.health} inScope={!!p.in_scope} />
            <div className="pr-branches" aria-label="Ветки pull request">
              <BranchLabel kind="source" value={p.source_branch} />
              <span aria-hidden="true">→</span>
              <BranchLabel kind="target" value={p.target_branch} />
            </div>
            {p.review_status === "awaiting_answers" && (
              <Link className="chat-ticket-link" to="/pull-requests?tab=inbox">
                Ответить на вопросы ревьюера →
              </Link>
            )}
            <div className="pr-author">
              <span className="pr-avatar" aria-hidden="true">
                {(p.author || "?").slice(0, 1).toUpperCase()}
              </span>
              <div>
                <small>Автор</small>
                <strong>{p.author || "Не указан"}</strong>
              </div>
            </div>
            <p className="muted">
              Создан:{" "}
              {p.created_at ? (
                <time dateTime={p.created_at}>
                  {new Date(p.created_at).toLocaleString("ru-RU")}
                </time>
              ) : (
                "дата пока не загружена"
              )}
            </p>
            <PrDescription pr={p} />
            <details className="pr-content-section">
              <summary>
                <Ticket size={17} aria-hidden="true" />
                Тикеты из описания · {p.tickets?.length || 0}
              </summary>
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
                    <Link
                      className="pr-ticket-jump"
                      to={ticketPath(t.id, p.ticket_source)}
                    >
                      Перейти к тикету #{t.id}
                    </Link>
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
            {!p.in_scope && (
              <p className="muted">
                PR вне текущей выборки. Сохранённые результаты доступны ниже.
              </p>
            )}
            {p.error && <p className="error">{p.error}</p>}
            {(p.summary || p.coverage) && (
              <details className="pr-review-result pr-result-accordion">
                <summary>
                  <ClipboardCheck size={17} aria-hidden="true" />
                  Результат ревью
                </summary>
                {p.coverage && (
                  <p className="muted">
                    Покрытие: {JSON.parse(p.coverage).files} файлов.{" "}
                    {JSON.parse(p.coverage).notes.join("; ")}
                  </p>
                )}

                {p.finished_at && (
                  <small>
                    {new Date(p.finished_at).toLocaleString("ru-RU")}
                  </small>
                )}
                {p.summary && <ChatMarkdown text={p.summary} />}
              </details>
            )}
            <ReviewHistory pr={p} />
          </article>
        ))}
      </div>
    </>
  );
}
