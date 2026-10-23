import { PrChangeButtons } from "./PrChangeButtons.js";
import { defaultPrFilters, usePrFilters } from "./usePrFilters.js";
import { PrTicketSourcesInfo } from "./PrTicketSourcesInfo.js";
import { BranchLabel } from "./PrBranchLabel.js";
import { ciMergeReason } from "../server/pr-health.js";
import { ConfirmButton } from "./ConfirmButton.js";
import { ChatTools } from "./ChatTools.js";
import { InitialsAvatar } from "./InitialsAvatar.js";
import { PrCreateDialog } from "./PrCreateDialog.js";
import { LastSync } from "./LastSync.js";
import { PrInfoPopup } from "./PrInfoPopup.js";
import { PrCommitsDialog } from "./PrCommitsDialog.js";
import { PrReviewDialog } from "./PrReviewDialog.js";
import { TicketMetadata } from "./TicketMetadata.js";
import { PrTicketLink } from "./PrTicketLink.js";
import { PrHealth } from "./PrHealth.js";
import { PrDiffDialog } from "./PrDiffDialog.js";
import { PrMergeDialog } from "./PrMergeDialog.js";
import { SingleSelect } from "./SingleSelect.js";
import {
  ArrowUpRight,
  RotateCcw,
  RefreshCw,
  TriangleAlert,
  CircleMinus,
  CircleCheck,
  Trash2,
  LockKeyhole,
  Eye,
  GitMerge,
  GitPullRequestClosed,
  FilePenLine,
  Send,
  GitBranch,
  Check,
  FileText,
  History,
  Info,
  Layers3,
  Ticket,
  ClipboardCheck,
  Sparkles,
  Clock,
  MessageCircle,
  LoaderCircle,
} from "lucide-react";
import { filterPullRequests } from "./pr-filters.js";
import { Link, useLocation } from "react-router-dom";
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

function openPrTicket(pr: { ticket_source: string }, ticket: { id: number; title?: string }) {
  window.dispatchEvent(new CustomEvent("orbit-show-ticket-details", {
    detail: { source: pr.ticket_source, tickets: [{ id: ticket.id, title: ticket.title || `#${ticket.id}` }] },
  }));
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
          aria-label="Открыть тикеты из описания"
        >
          {pr.tickets.map((t: any) => (
            <button
              type="button"
              className="chat-ticket-link"
              key={t.id}
              onClick={() => openPrTicket(pr, t)}
            >
              Открыть тикет #{t.id}
              <Eye size={14} aria-hidden="true" />
            </button>
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

function ReviewDetail({ result, pr }: any) {
  let coverage: any = null;
  try {
    coverage = result.coverage ? JSON.parse(result.coverage) : null;
  } catch {}
  const previous = result.head !== pr.head || result.target !== pr.target;
  return (
      <div className="pr-review-detail">
        <header className="pr-review-detail-header">
          <div className="pr-review-detail-meta">
            {result.status && <span>{statuses[result.status] || result.status}</span>}
            <span><strong>Модель:</strong> {result.model || "Не сохранена для этого ревью"}</span>
            {result.finished_at && <time dateTime={result.finished_at}>{new Date(result.finished_at).toLocaleString("ru-RU")}</time>}
            {coverage && <span><strong>Покрытие:</strong> {coverage.files} файлов</span>}
          </div>
          <ReviewTokenUsage usage={result.review_usage} />
          {previous && (
            <p className="muted">
              Ревью предыдущей версии PR: {result.head?.slice(0, 10)} → {result.target?.slice(0, 10)}.
            </p>
          )}
          {!!coverage?.notes?.length && <p className="muted">{coverage.notes.join("; ")}</p>}
        </header>
        {result.error && <p className="error">{result.error}</p>}
        {result.summary ? (
          <ChatMarkdown text={result.summary} />
        ) : (
          <p className="muted">
            Отчёт ещё не готов. Показаны сведения о подготовленном diff.
          </p>
        )}
      </div>
  );
}

function ReviewResult({ pr }: any) {
  const result = pr.summary ? pr : pr.last_saved_review || pr;
  return (
    <PrInfoPopup title="Открыть результат ревью"
      className={`icon-button pr-open-review${result.summary ? "" : " is-preparing"}`}
      trigger={<Eye size={16} aria-hidden="true" />}>
      <ReviewDetail result={result} pr={pr} />
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
      <div className="pr-review-history-list">
        {items.map((r) => (
          <PrInfoPopup key={r.id}
            title={`Ревью версии ${r.head.slice(0, 10)}`}
            className="pr-review-history-row"
            trigger={<>
              <ClipboardCheck size={18} aria-hidden="true" />
              <span className="pr-review-history-row-info">
                <strong>Ревью версии {r.head.slice(0, 10)}</strong>
                <span>{new Date(r.created_at).toLocaleString("ru-RU")} · {statuses[r.status] || r.status}</span>
                <span>{r.model || "Модель не сохранена"}{r.review_usage?.totalTokens != null ? ` · ${r.review_usage.totalTokens.toLocaleString("ru-RU")} токенов` : ""}</span>
              </span>
              <Eye size={16} aria-hidden="true" />
            </>}>
            <ReviewDetail result={r} pr={pr} />
          </PrInfoPopup>
        ))}
      </div>
    </PrInfoPopup>
  );
}
export function PullRequestsPage({ context, settings, completedItems, onCompletedReimport }: any) {
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
  const { filters: { draft: draftFilter, review: reviewFilter, sort }, update: updateFilters } = usePrFilters(context.client || "");
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
  async function changePrState(pr: any, action: "abandon" | "draft" | "publish") {
    setBusy(true); setError("");
    try {
      const result = await api("/pr/state", "POST", { monitor: pr.monitor, repo: pr.repo, number: pr.number, action });
      setVersion(value => value + 1);
      window.dispatchEvent(new CustomEvent("orbit:data-synced"));
      if (result.warning) setError(result.warning);
    } finally { setBusy(false); }
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
          statusColors={settings?.statusColors}
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
                <RefreshCw size={15} aria-hidden="true" />
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

          <section className="ticket-filter-panel pr-filter-panel" aria-label="Фильтры pull request">
          <div className="ticket-filters">
            <button
              className="secondary"
              disabled={
                draftFilter === "all" &&
                reviewFilter === "all" &&
                sort === "created:desc"
              }
              onClick={() => {
                updateFilters(defaultPrFilters);
              }}
            >
              <RotateCcw size={15} /> Сбросить фильтры
            </button>
            <SingleSelect
              label="Тип PR"
              value={draftFilter}
              onChange={draft => updateFilters({ draft })}
              active={draftFilter !== "all"}
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
              onChange={review => updateFilters({ review })}
              active={reviewFilter !== "all"}
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
              onChange={sort => updateFilters({ sort })}
              active={sort !== "created:desc"}
              options={[
                { value: "created:desc", label: "Созданы: сначала новые" },
                { value: "created:asc", label: "Созданы: сначала старые" },
                { value: "number:desc", label: "Номер: по убыванию" },
                { value: "number:asc", label: "Номер: по возрастанию" },
                { value: "title:asc", label: "Название: А–Я" },
              ]}
            />
          </div>
          </section>
          <p className="muted pr-filter-count" role="status">
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
                      <PrHealth value={p.health} inScope={!!p.in_scope} pr={p} onUpdated={() => setVersion(v => v + 1)} />
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
                        <a href={p.url} target="_blank" rel="noreferrer" title={p.title}>
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
                      {!readOnly && <button
                        type="button" className="secondary pr-refresh-one" disabled={busy}
                        aria-label={`Обновить PR #${p.number}`}
                        title="Полная деталка, связи и проверки будут обновлены из Azure. Локальные привязки тикетов и отметки «Не учитывать» сохранятся. Остальные PR не изменятся."
                        onClick={() => void run(() => api("/pr/reimport", "POST", {monitor:p.monitor,repo:p.repo,number:p.number}))}
                      ><RefreshCw size={14} aria-hidden="true" /> Обновить</button>}
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
              <BranchLabel kind="source" value={p.source_branch} client={p.client} project={p.project} />
              <span aria-hidden="true">→</span>
              <BranchLabel kind="target" value={p.target_branch} client={p.client} project={p.project} />
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

                <PrChangeButtons pr={p} onDiff={() => setViewingDiff(p)} onCommits={() => setViewingCommits(p)} />
                {readOnly && <ConfirmButton
                  disabled={busy}
                  title={`Переимпортировать PR #${p.number}?`}
                  message="Полное описание и связи будут заново загружены из Azure и заменят локальный кэш. Все локальные привязки тикетов и отметки «Не учитывать» будут удалены. Останутся только связи из Azure, названия и описания PR. Это действие нельзя отменить."
                  confirmLabel="Переимпортировать"
                  onConfirm={async () => {
                    setBusy(true);
                    try {
                      const updated = await api("/pr/completed/reimport", "POST", { monitor: p.monitor, repo: p.repo, number: p.number });
                      onCompletedReimport?.(updated);
                    } finally { setBusy(false); }
                  }}
                ><RefreshCw size={15} aria-hidden="true" /> Переимпортировать</ConfirmButton>}
                {p.has_review_log && <ChatTools
                  context={context}
                  review={{
                    monitor: p.monitor,
                    repo: p.repo,
                    number: p.number,
                  }}
                />}
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
                  <span title={ciMergeReason(p.health) || "Слить pull request"}>
                  <button
                    type="button"
                    className="secondary pr-merge-action"
                    disabled={busy || !p.in_scope || !p.enabled || !!p.draft || !!ciMergeReason(p.health)}
                    onClick={() => setMerging(p)}
                  >
                    <GitMerge size={17} aria-hidden="true" /> Merge
                  </button></span>
                  <ConfirmButton className="secondary pr-draft-action" disabled={busy || !p.in_scope || !p.enabled}
                    title={p.draft ? "Снять статус черновика?" : "Перевести PR в черновик?"}
                    message={`PR #${p.number}: ${p.title}. ${p.draft ? "Pull request станет доступен для ревью." : "Pull request станет черновиком. Текущее автоматическое ревью будет остановлено."}`}
                    confirmLabel={p.draft ? "Unmark as Draft" : "Mark as Draft"}
                    onConfirm={() => changePrState(p, p.draft ? "publish" : "draft")}>
                    {p.draft ? <Send size={16} /> : <FilePenLine size={16} />}{p.draft ? "Unmark as Draft" : "Mark as Draft"}
                  </ConfirmButton>
                  <ConfirmButton className="secondary pr-abandon-action" disabled={busy || !p.in_scope || !p.enabled}
                    title="Закрыть pull request без слияния?" message={`PR #${p.number}: ${p.title}. Будет установлен статус Abandoned. Ветка не удаляется, изменения не сливаются. Текущее автоматическое ревью будет остановлено.`}
                    confirmLabel="Abandon" onConfirm={() => changePrState(p, "abandon")}>
                    <GitPullRequestClosed size={16} />Abandon
                  </ConfirmButton>
                </div>
              )}
            </div>
            {!readOnly && p.review_status === "awaiting_answers" && (
              <Link className="chat-ticket-link" to="/pull-requests?tab=inbox">
                Ответить на вопросы ревьюера →
              </Link>
            )}
            <PrDescription pr={p} />
            <details className="pr-content-section pr-linked-tickets">
              <summary>
                <span className="pr-ticket-summary-content">
                  <Ticket size={17} aria-hidden="true" />
                  <span>Связанные тикеты</span>
                  <span className="pr-ticket-count">{p.tickets?.length || 0}</span>
                  <PrTicketSourcesInfo />
                </span>
              </summary>
              {!readOnly && (
                <PrTicketLink
                  pr={p}
                  settings={settings}
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
                  <div className={`pr-ticket-row${t.disabled ? " is-disabled" : ""}`} key={t.id}>
                    <small className="pr-ticket-origin">
                      Импортировано из: {[
                        t.manual && "добавлено локально",
                        t.fromAzure && "Azure",
                        t.fromDescription && "найдено в описании",
                        t.fromTitle && "найдено в названии",
                      ].filter(Boolean).join(" · ") || "источник больше недоступен"}
                    </small>
                    <strong className="pr-ticket-heading">
                      <Ticket size={17} aria-hidden="true" />
                      <span className="pr-ticket-number">#{t.id}</span>
                      {t.title && <span>{t.title}</span>}
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
                    <div className="pr-ticket-actions">
                      {!t.unavailable && <TicketMetadata ticket={t} context={context} field="notes" onChange={() => setVersion(v => v+1)} />}
                      <button
                        type="button"
                        className="pr-ticket-action is-open"
                        onClick={() => openPrTicket(p, t)}
                      >
                        <Eye size={15} aria-hidden="true" />
                        Открыть тикет
                      </button>
                      {!readOnly && <button type="button" className={`pr-ticket-action ${t.disabled ? "is-enable" : "is-exclude"}`} disabled={busy}
                        title="Включает или исключает тикет из ревью и смены статуса при merge. Связи в Azure и локальная привязка сохраняются."
                        onClick={() => void run(() => api("/pr/tickets", "POST", {
                          monitor: p.monitor, repo: p.repo, number: p.number, ticketId: t.id,
                          source: p.ticket_source, action: t.disabled ? "enable" : "disable",
                        }))}>
                        {t.disabled ? <CircleCheck size={15} aria-hidden="true" /> : <CircleMinus size={15} aria-hidden="true" />}
                        {t.disabled ? "Учитывать" : "Не учитывать"}
                      </button>}
                      {!readOnly && t.manual && (
                        <button
                          type="button"
                          className="pr-ticket-action is-unlink"
                          title={t.fromDescription || t.fromTitle || t.fromAzure
                            ? "Удалить локальную привязку. Связи из Azure, названия и описания останутся."
                            : "Удалить локальную привязку тикета к PR"}
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
                          <Trash2 size={15} aria-hidden="true" />
                          Отвязать
                        </button>
                      )}
                    </div>
                    {t.disabled && <span className="pr-ticket-exclusion-note">
                      <TriangleAlert size={16} aria-hidden="true" />
                      Не учитывается в ревью и смене статуса при merge. Связь сохранена.
                    </span>}
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
