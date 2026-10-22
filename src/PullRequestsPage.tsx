import { ChatTools } from "./ChatTools.js";
import { InitialsAvatar } from "./InitialsAvatar.js";
import { PrCreateDialog } from "./PrCreateDialog.js";
import { LastSync } from "./LastSync.js";
import { PrInfoPopup } from "./PrInfoPopup.js";
import { PrCommitsDialog } from "./PrCommitsDialog.js";
import { PrReviewDialog } from "./PrReviewDialog.js";
import { PrTicketLink } from "./PrTicketLink.js";
import { PrHealth } from "./PrHealth.js";
import { PrDiffDialog } from "./PrDiffDialog.js";
import { PrMergeDialog } from "./PrMergeDialog.js";
import { SingleSelect } from "./SingleSelect.js";
import {
  ArrowUpRight,
  LockKeyhole,
  Code2,
  Eye,
  GitMerge,
  GitBranch,
  Copy,
  Check,
  FileText,
  History,
  Info,
  Layers3,
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
  preparing_git: "Подготовка Git",
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
          <ChatMarkdown
            text={pr.description}
            images={pr.images}
            preserveLineBreaks
          />
        ) : (
          <p className="muted">Описание не указано.</p>
        ))}
      {open && !!pr.tickets?.length && (
        <div
          className="pr-ticket-navigation"
          aria-label="Переходы к тикетам из описания"
        >
          {pr.tickets.map((t: any) => (
            <Link
              className="chat-ticket-link"
              key={t.id}
              to={ticketPath(t.id, pr.ticket_source)}
            >
              Перейти к тикету #{t.id}
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </details>
  );
}
function ReviewTokenUsage({ usage }: { usage?: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; partial: boolean } }) {
  const format = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("ru-RU");
  return <div className="pr-review-token-usage">
    <strong>Токены: {format(usage?.totalTokens)}</strong>
    <span>Вход: {format(usage?.inputTokens)}</span>
    <span>Выход: {format(usage?.outputTokens)}</span>
    {(!usage || usage.partial) && <small>{usage?.totalTokens != null ? "Учёт неполный" : "Данные о расходе недоступны"}</small>}
  </div>;
}

function ReviewResult({ pr }: any) {
  const result = pr.summary ? pr : pr.last_saved_review || pr;
  let coverage: any = null;
  try {
    coverage = result.coverage ? JSON.parse(result.coverage) : null;
  } catch {}
  const previous = result.head !== pr.head || result.target !== pr.target;
  return (
    <PrInfoPopup
      title="Открыть результат ревью"
      className={`icon-button pr-open-review${result.summary ? "" : " is-preparing"}`}
      trigger={<Eye size={16} aria-hidden="true" />}
    >
      <div className="pr-review-result">
        <small className="muted">
          Модель: {result.model || "Не сохранена для этого ревью"}
        </small>
        <ReviewTokenUsage usage={result.review_usage} />
        {previous && (
          <p className="muted">
            Ревью предыдущей версии PR: {result.head?.slice(0, 10)} →{" "}
            {result.target?.slice(0, 10)}.
          </p>
        )}
        {coverage && (
          <p className="muted">
            Покрытие: {coverage.files} файлов.{" "}
            {(coverage.notes || []).join("; ")}
          </p>
        )}
        {result.finished_at && (
          <small>{new Date(result.finished_at).toLocaleString("ru-RU")}</small>
        )}
        {result.summary ? (
          <ChatMarkdown text={result.summary} />
        ) : (
          <p className="muted">
            Отчёт ещё не готов. Показаны сведения о подготовленном diff.
          </p>
        )}
      </div>
    </PrInfoPopup>
  );
}
function ReviewHistory({ pr }: any) {
  const [items, setItems] = useState<any[]>([]),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setError("");
    api(
      `/pr/reviews?${new URLSearchParams({ monitor: pr.monitor, repo: pr.repo, number: String(pr.number) })}`,
    )
      .then((v) => {
        if (live) {
          setItems(v);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [open, pr.review_status]);
  return (
    <PrInfoPopup
      title="Сохранённые ревью всех версий"
      trigger={
        <span className="pr-review-history-icon">
          <History size={16} aria-hidden="true" />
          <ClipboardCheck size={16} aria-hidden="true" />
        </span>
      }
      onOpenChange={setOpen}
    >
      {error && <p className="error">{error}</p>}
      {loading && <p role="status">Загружаю историю…</p>}
      {!loading && !error && !items.length && (
        <p className="muted">Ревью ещё не запускалось.</p>
      )}
      {items.map((r) => (
        <section className="pr-review-result" key={r.id}>
          <h3>Ревью версии {r.head.slice(0, 10)}</h3>
          <small>
            {new Date(r.created_at).toLocaleString("ru-RU")} ·{" "}
            {r.head.slice(0, 10)} → {r.target.slice(0, 10)} ·{" "}
            {statuses[r.status]}
          </small>
          <div>
            <small className="muted">
              Модель: {r.model || "Не сохранена для этого ревью"}
            </small>
          </div>
          <ReviewTokenUsage usage={r.review_usage} />
          {r.summary && <ChatMarkdown text={r.summary} />}
          {r.error && <p className="error">{r.error}</p>}
        </section>
      ))}
    </PrInfoPopup>
  );
}
export function PullRequestsPage({ context, settings, completedItems }: any) {
  const readOnly = completedItems !== undefined;
  const [prs, setPrs] = useState<any[]>([]),
    [monitors, setMonitors] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<any>(null);
  const [merging, setMerging] = useState<any>(null);
  const [viewingCommits, setViewingCommits] = useState<any>(null);
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
    if (readOnly) {
      setPrs(completedItems);
      setLoaded(true);
      return;
    }
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
    const synced = () => void load();
    window.addEventListener("orbit:data-synced", synced);
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("orbit:data-synced", synced);
    };
  }, [query, version, completedItems, readOnly]);
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
      {creating && (
        <PrCreateDialog
          onCreated={() => setVersion((v) => v + 1)}
          monitors={monitors.filter(
            (m) =>
              (!context.client || m.client === context.client) &&
              (!context.project || m.project === context.project),
          )}
          onClose={() => {
            setCreating(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
      {reviewing && (
        <PrReviewDialog
          defaultMaxTokens={settings.reviewMaxTokens ?? 1_000_000}
          pr={
            prs.find(
              (p) =>
                p.monitor === reviewing.monitor &&
                p.repo === reviewing.repo &&
                p.number === reviewing.number,
            ) ?? reviewing
          }
          onClose={() => setReviewing(null)}
          onStarted={() => {
            setReviewing(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
      {viewingCommits && (
        <PrCommitsDialog
          pr={viewingCommits}
          onClose={() => setViewingCommits(null)}
        />
      )}
      {viewingDiff && (
        <PrDiffDialog pr={viewingDiff} onClose={() => setViewingDiff(null)} />
      )}
      {merging && (
        <PrMergeDialog
          pr={merging}
          onClose={() => {
            setMerging(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
      {!readOnly && (
        <>
          <div className="page-heading pr-page-heading">
            <div>
              <h1>Pull requests</h1>
              <div className="pr-sync-summary">
                {monitors
                  .filter(
                    (m) =>
                      m.enabled &&
                      (!context.client || m.client === context.client) &&
                      (!context.project || m.project === context.project),
                  )
                  .map((m) => (
                    <LastSync
                      key={m.id}
                      at={m.synced_at}
                      label={`Синхронизация · ${m.repository}`}
                    />
                  ))}
                {!monitors.some(
                  (m) =>
                    m.enabled &&
                    (!context.client || m.client === context.client) &&
                    (!context.project || m.project === context.project),
                ) && (
                  <p className="last-sync">
                    Синхронизация PR не настроена для выбранного контекста.
                  </p>
                )}

                <span className="muted pr-poll-interval">
                  Опрос: {(settings?.syncSeconds || 600) / 60} мин.
                </span>
              </div>
            </div>
            <div className="pr-page-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void run(() => api("/pr/sync", "POST", {}))}
              >
                Синхронизировать PR
              </button>
              <button className="primary" onClick={() => setCreating(true)}>
                ＋ Создать PR
              </button>
            </div>
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
              (m) =>
                m.client === context.client &&
                m.project === context.project &&
                (m.error || !m.enabled),
            )
            .map((m) => (
              <p className="muted" key={m.id}>
                {m.azure_project} / {m.repository || "Репозиторий не выбран"} ·{" "}
                {m.error || "Опрос выключен"}
              </p>
            ))}

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
            Показано {visiblePrs.length} из {prs.length}.
          </p>
          {!!prs.length && !visiblePrs.length && (
            <div className="empty">
              Нет PR по выбранным фильтрам. Измените условия или сбросьте
              фильтры.
            </div>
          )}
          {!prs.length && (
            <div className="empty">
              PR пока нет. Укажите Git-репозиторий через «Заказчики и проекты»
              сверху и запустите синхронизацию.
            </div>
          )}
        </>
      )}
      <div className="card-list">
        {visiblePrs.map((p) => (
          <article
            className={`panel pr-review${p.draft ? " pr-draft" : ""}${target ? " pr-focused" : ""}`}
            ref={target ? focusRef : undefined}
            tabIndex={target ? -1 : undefined}
            key={`${p.monitor}:${p.repo}:${p.number}`}
          >
            <div className="pr-card-header">
              <div className="pr-card-heading">
                <div className="pr-card-labels">
                  <span className="pr-kind-badge">PR</span>
                  {readOnly && (
                    <span className="pr-completed-label">
                      <LockKeyhole size={14} />
                      Completed PR
                    </span>
                  )}
                  <span
                    className={`pr-review-status pr-review-outcome ${p.review_status === "completed" ? "is-ready" : ["error", "interrupted"].includes(p.review_status) ? "is-error" : ["preparing_git", "running", "queued", "awaiting_answers"].includes(p.review_status) ? "is-pending" : "is-idle"}`}
                  >
                    {statuses[p.review_status] || "Ревью не запускалось"}
                  </span>
                  {!readOnly &&
                    [
                      "preparing_git",
                      "queued",
                      "running",
                      "awaiting_answers",
                    ].includes(p.review_status) && (
                      <button
                        className="secondary pr-stop-review"
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            api("/pr/review/stop", "POST", { id: p.review_id }),
                          )
                        }
                      >
                        Остановить ревью
                      </button>
                    )}
                  {(p.summary || p.coverage || p.last_saved_review) && (
                    <ReviewResult pr={p} />
                  )}
                  {p.review_count > 1 && <ReviewHistory pr={p} />}
                  {!!p.draft && <span className="badge">Черновик</span>}
                  {!readOnly && (
                    <div className="pr-card-statuses">
                      <PrHealth value={p.health} inScope={!!p.in_scope} />
                      <span
                        className={`pr-local-source ${p.local_source?.status === "ready" ? "is-ready" : p.local_source?.status === "loading" ? "is-loading" : ["error", "stale"].includes(p.local_source?.status) ? "is-error" : ""}`}
                        title={
                          p.local_source?.error ||
                          p.local_source?.stage ||
                          p.source_branch
                        }
                      >
                        {p.local_source?.status === "loading" ? (
                          <LoaderCircle size={13} className="spin" />
                        ) : (
                          <GitBranch size={13} />
                        )}
                        {p.local_source?.status === "ready"
                          ? "Локальная ветка готова"
                          : p.local_source?.status === "loading"
                            ? "Ветка загружается"
                            : p.local_source?.status === "stale"
                              ? "Ветка устарела"
                              : p.local_source?.status === "error"
                                ? "Локальная ветка не готова"
                                : "Ветка не запрашивалась"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="pr-identity-row">
                  <div className="pr-identity">
                    <InitialsAvatar name={p.author || "?"} />
                    <div className="pr-identity-text">
                      <h2 className="pr-title">
                        <a href={p.url} target="_blank" rel="noreferrer">
                          #{p.number} · {p.title}
                        </a>
                      </h2>
                      <p className="muted pr-created-at">
                        <strong>{p.author || "Автор не указан"}</strong>
                        {" · Создан: "}
                        {p.created_at ? (
                          <time dateTime={p.created_at}>
                            {new Date(p.created_at).toLocaleString("ru-RU")}
                          </time>
                        ) : (
                          "дата пока не загружена"
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="pr-card-utilities">
                    <div
                      className="pr-card-info-actions"
                      role="group"
                      aria-label="Информация о PR"
                    >
                      <PrInfoPopup
                        title="Контекст PR"
                        trigger={<Layers3 size={17} aria-hidden="true" />}
                      >
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
                      </PrInfoPopup>
                      <PrInfoPopup
                        title="Версия изменений"
                        trigger={<Info size={17} aria-hidden="true" />}
                      >
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
                      </PrInfoPopup>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="pr-branches" aria-label="Ветки pull request">
              <BranchLabel kind="source" value={p.source_branch} />
              <span aria-hidden="true">→</span>
              <BranchLabel kind="target" value={p.target_branch} />
            </div>
            <div className="pr-card-actions">
              <div className="pr-action-group">
                {!readOnly && (
                  <button
                    className="pr-review-launch"
                    disabled={
                      busy ||
                      !p.in_scope ||
                      !p.enabled ||
                      !!p.draft ||
                      [
                        "preparing_git",
                        "queued",
                        "running",
                        "awaiting_answers",
                      ].includes(p.review_status)
                    }
                    onClick={() => setReviewing(p)}
                  >
                    {p.review_status === "completed" ? (
                      <Check size={17} aria-hidden="true" />
                    ) : p.review_status === "running" ? (
                      <LoaderCircle
                        className="spin"
                        size={17}
                        aria-hidden="true"
                      />
                    ) : p.review_status === "preparing_git" ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : p.review_status === "queued" ? (
                      <Clock size={17} aria-hidden="true" />
                    ) : p.review_status === "awaiting_answers" ? (
                      <MessageCircle size={17} aria-hidden="true" />
                    ) : (
                      <Sparkles size={17} aria-hidden="true" />
                    )}
                    {p.review_status === "completed"
                      ? "Повторить ревью"
                      : p.review_status === "awaiting_answers"
                        ? "Ожидает ответов"
                        : p.review_status === "running"
                          ? "Ревью выполняется"
                          : p.review_status === "preparing_git"
                            ? "Подготовка Git"
                            : p.review_status === "queued"
                              ? "Ревью в очереди"
                              : "Запустить ревью"}
                  </button>
                )}

                <button
                  type="button"
                  className="secondary pr-diff-action"
                  onClick={() => setViewingDiff(p)}
                >
                  <Code2 size={17} aria-hidden="true" /> View Diff
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setViewingCommits(p)}
                >
                  <GitCommitHorizontal size={17} aria-hidden="true" /> Коммиты
                </button>
                <ChatTools
                  context={context}
                  review={{
                    monitor: p.monitor,
                    repo: p.repo,
                    number: p.number,
                  }}
                />
                {!readOnly && (
                  <button
                    type="button"
                    className="secondary pr-source-action"
                    disabled={
                      busy ||
                      !p.enabled ||
                      !p.in_scope ||
                      p.local_source?.status === "ready" ||
                      p.local_source?.status === "loading" ||
                      p.review_status === "preparing_git"
                    }
                    onClick={() =>
                      run(() =>
                        api("/pr/source", "POST", {
                          monitor: p.monitor,
                          repo: p.repo,
                          number: p.number,
                        }),
                      )
                    }
                  >
                    <GitBranch size={16} />
                    Загрузить source-ветку
                  </button>
                )}
              </div>
              {!readOnly && (
                <div className="pr-action-group pr-merge-actions">
                  <button
                    type="button"
                    className="secondary pr-merge-action"
                    disabled={busy || !p.in_scope || !p.enabled || !!p.draft}
                    onClick={() => setMerging(p)}
                  >
                    <GitMerge size={17} aria-hidden="true" /> Merge
                  </button>
                </div>
              )}
            </div>
            {!readOnly && p.review_status === "awaiting_answers" && (
              <Link className="chat-ticket-link" to="/pull-requests?tab=inbox">
                Ответить на вопросы ревьюера →
              </Link>
            )}
            <PrDescription pr={p} />
            <details className="pr-content-section">
              <summary>
                <Ticket size={17} aria-hidden="true" />
                Связанные тикеты · {p.tickets?.length || 0}
              </summary>
              {!readOnly && (
                <PrTicketLink
                  pr={p}
                  onChange={() => setVersion((v) => v + 1)}
                />
              )}
              {p.ticket_error && <p className="error">{p.ticket_error}</p>}
              {!p.tickets?.length && (
                <p className="muted">Связанных тикетов пока нет.</p>
              )}
              {p.ticket_links_error && (
                <p className="error">{p.ticket_links_error}</p>
              )}
              <div className="pr-ticket-list">
                {(p.tickets || []).map((t: any) => (
                  <div className="pr-ticket-row" key={t.id}>
                    <Link
                      className="chat-ticket-link pr-ticket-jump"
                      to={ticketPath(t.id, p.ticket_source)}
                    >
                      Перейти к тикету #{t.id}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </Link>
                    <strong>
                      #{t.id}
                      {t.title ? ` · ${t.title}` : ""}
                    </strong>
                    <span className="muted">
                      {[
                        t.fromAzure && "Azure",
                        t.fromTitle && "Название PR",
                        t.fromDescription && "Описание PR",
                        t.manual && "Локально",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {!readOnly && t.manual && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api("/pr/tickets", "POST", {
                              monitor: p.monitor,
                              repo: p.repo,
                              number: p.number,
                              ticketId: t.id,
                              source: p.ticket_source,
                              action: "unlink",
                            }),
                          )
                        }
                      >
                        Отвязать локально
                        {t.fromDescription || t.fromTitle || t.fromAzure
                          ? " (связь из других источников останется)"
                          : ""}
                      </button>
                    )}
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
            {readOnly && (
              <p className="pr-retention-note">
                <LockKeyhole size={14} />
                Завершён {new Date(p.closedAt).toLocaleString("ru-RU")}.
                Локальная копия и ревью будут удалены{" "}
                {new Date(p.expiresAt).toLocaleString("ru-RU")}. В Azure PR
                сохранится.
              </p>
            )}
            {!readOnly && !p.in_scope && (
              <p className="muted">
                PR вне текущей выборки. Сохранённые результаты доступны вверху
                карточки.
              </p>
            )}
            {p.error && <p className="error">{p.error}</p>}
          </article>
        ))}
      </div>
    </>
  );
}
