import { AzureAssignee } from "./AzureAssignee.js";
import { ImagePreview } from "./ImagePreview.js";
import { openTicketAnalysis } from "./chat-ticket-analysis.js";
import { PrInfoPopup } from "./PrInfoPopup.js";
import { TicketSectionScroll } from "./TicketSectionScroll.js";
import { OrderedTicketCells } from "./TicketColumns.js";
import { TicketMetadata } from "./TicketMetadata.js";
import { InitialsAvatar } from "./InitialsAvatar.js";
import { LocalAssigneeNames } from "./LocalAssigneeNames.js";
import { Link } from "react-router-dom";
import { pullRequestPath, ticketPath } from "./routing.js";
import {
  Sparkles,
  LoaderCircle,
  Copy,
  Link2,
  Check,
  ArrowUpRight,
  ExternalLink,
  Eye,
  EyeOff,
  Trash2,
  FileText,
  ListChecks,
  Bug,
  GitPullRequest,
  MessageSquare,
  Paperclip,
  Database,
  NotebookPen,
  Send,
} from "lucide-react";
import { TicketRichText } from "./TicketRichText.js";
import { LocalDeveloper, StatusBadge, TicketStatus } from "./TicketControls.js";
import { useEffect, useState, useId, useRef, type ReactNode } from "react";
import { api } from "./api.js";
import { ticketText as text } from "./ticket-text.js";
export function TicketCard({ reference }: { reference: string }) {
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [removalError, setRemovalError] = useState("");
  const removalPending = useRef(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const analysisPending = useRef(false);
  const [typeColors, setTypeColors] = useState<Record<string, string>>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  useEffect(() => {
    api("/settings")
      .then((s) => {
        setColors(s.statusColors || {});
        setTypeColors(s.typeColors || {});
      })
      .catch(() => {});
  }, []);
  const [card, setCard] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const update = (event: Event) => {
      const { id, source, comment } = (event as CustomEvent).detail;
      setCard((old: any) =>
        old?.id === id && old?.source === source
          ? {
              ...old,
              comments: [
                ...old.comments.filter((c: any) => c.id !== comment.id),
                comment,
              ],
            }
          : old,
      );
    };
    window.addEventListener("orbit:ticket-comment", update);
    return () => window.removeEventListener("orbit:ticket-comment", update);
  }, []);
  useEffect(() => {
    const update = (event: Event) => {
      const { id, source, developers } = (event as CustomEvent).detail;
      setCard((old: any) =>
        old?.id === id && old?.source === source ? { ...old, developers } : old,
      );
    };
    window.addEventListener("orbit:ticket-developers", update);
    return () => window.removeEventListener("orbit:ticket-developers", update);
  }, []);
  useEffect(() => {
    const update = (event: Event) => {
      const { id, source, value } = (event as CustomEvent).detail;
      setCard((old: any) =>
        old?.id === id && old?.source === source
          ? { ...old, localMetadata: value }
          : old,
      );
    };
    window.addEventListener("orbit:ticket-metadata", update);
    return () => window.removeEventListener("orbit:ticket-metadata", update);
  }, []);

  useEffect(() => {
    let live = true;
    setCard(null);
    setError("");
    setRemoved(false);
    setRemovalError("");
    api(`/ticket-cards/${encodeURIComponent(reference)}`)
      .then((v) => {
        if (live) setCard(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [reference]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setCard((old: any) =>
        old && old.id === detail.id && old.source === detail.source
          ? { ...old, fields: { ...old.fields, "System.State": detail.state } }
          : old,
      );
    };
    window.addEventListener("orbit:ticket-state", changed);
    return () => window.removeEventListener("orbit:ticket-state", changed);
  }, []);
  useEffect(() => {
    const remove = (event: Event) => {
      const { id, source } = (event as CustomEvent).detail;
      setCard((old: any) =>
        old?.id === id && old?.source === source
          ? { ...old, locallyTracked: false }
          : old,
      );
    };
    window.addEventListener("orbit:ticket-removed", remove);
    return () => window.removeEventListener("orbit:ticket-removed", remove);
  }, []);
  useEffect(() => {
    const changed = (event: Event) => {
      const { id, source, assigned } = (event as CustomEvent).detail;
      setCard((old: any) =>
        old?.id === id && old?.source === source
          ? {
              ...old,
              fields: { ...old.fields, "System.AssignedTo": assigned || "" },
            }
          : old,
      );
    };
    window.addEventListener("orbit:ticket-assignee", changed);
    return () => window.removeEventListener("orbit:ticket-assignee", changed);
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!card) return <p>Загрузка карточки…</p>;
  const f = card.fields;
  const attachmentUrl = (a: any) =>
    `/api/ticket-cards/${encodeURIComponent(reference)}/attachments/${encodeURIComponent(a.id)}`;
  const person = (value: any) =>
    typeof value === "string"
      ? value
      : value?.displayName || value?.uniqueName || "Не указан";
  const timestamp = (value: any) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return "Не указана";
    return new Date(value).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  return (
    <article className="ticket-detail">
      <div className="ticket-detail-layout">
        <aside className="ticket-detail-sidebar" aria-label="Поля тикета">
          <dl className="ticket-metadata">
            <div>
              <dt>Номер</dt>
              <dd className="ticket-sidebar-number">
                <strong>#{card.id}</strong>
                <TicketCopyButton
                  key={`id:${card.id}`}
                  value={String(card.id)}
                  label="Скопировать номер тикета"
                />
              </dd>
            </div>
            <div>
              <dt>Автор</dt>
              <dd className="ticket-author-identity">
                <InitialsAvatar
                  name={
                    f["System.CreatedBy"] ? person(f["System.CreatedBy"]) : ""
                  }
                />
                <span>{person(f["System.CreatedBy"])}</span>
              </dd>
            </div>
            <div>
              <dt>Исполнитель</dt>
              <dd>
                <AzureAssignee
                  ticket={{
                    id: card.id,
                    source: card.source,
                    assigned: f["System.AssignedTo"]
                      ? person(f["System.AssignedTo"])
                      : "",
                  }}
                />
              </dd>
            </div>
            <div>
              <dt>Создан</dt>
              <dd>{timestamp(f["System.CreatedDate"])}</dd>
            </div>
            <div>
              <dt>Изменён</dt>
              <dd>{timestamp(f["System.ChangedDate"])}</dd>
            </div>
            <div>
              <dt>Локально получено</dt>
              <dd>{timestamp(card.loadedAt)}</dd>
            </div>
          </dl>
          <dl className="ticket-overview">
            <div>
              <dt>Тип задачи</dt>
              <dd>
                <StatusBadge
                  state={f["System.WorkItemType"] || "Тип не указан"}
                  colors={typeColors}
                  kind="type"
                />
              </dd>
            </div>
            <div>
              <dt>Статус</dt>
              <dd>
                <TicketStatus
                  id={card.id}
                  source={card.source}
                  state={f["System.State"] || ""}
                  colors={colors}
                />
              </dd>
            </div>
            {card.localMetadata && (
              <div>
                <dt>Локальный приоритет</dt>
                <dd>
                  {card.locallyTracked ? (
                    <TicketMetadata
                      ticket={{
                        id: card.id,
                        source: card.source,
                        ...card.localMetadata,
                      }}
                      context={card.localContext}
                      field="priority"
                      onChange={() => {}}
                    />
                  ) : (
                    <span className="badge ticket-priority-badge">
                      P{card.localMetadata.priority}
                    </span>
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt>Локальное поручение</dt>
              <dd>
                {card.locallyTracked ? (
                  <LocalDeveloper ticket={card} context={card.localContext} />
                ) : (
                  <LocalAssigneeNames
                    names={(card.developers || []).map((d: any) => d.name)}
                  />
                )}
              </dd>
            </div>
            {!!card.localMetadata?.tags?.length && (
              <div className="ticket-overview-tags">
                <dt>Теги</dt>
                <dd>
                  {card.localMetadata.tags.map((tag: string) => (
                    <span className="badge" key={tag}>
                      {tag}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
          <div className="ticket-sidebar-actions">
            {card.locallyTracked ? (
              <TicketMetadata
                ticket={{
                  id: card.id,
                  source: card.source,
                  ...card.localMetadata,
                }}
                context={card.localContext}
                field="notes"
                showLabel
                onChange={() => {}}
              />
            ) : (
              <PrInfoPopup
                title={`Локальные заметки · #${card.id}`}
                className="secondary ticket-notes-trigger"
                trigger={
                  <>
                    <NotebookPen size={16} /> Заметки
                  </>
                }
              >
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {card.localMetadata?.notes || "Локальных заметок пока нет."}
                </p>
                <p className="muted">
                  Для редактирования добавьте тикет в локальный список.
                </p>
              </PrInfoPopup>
            )}
            <PrInfoPopup
              title={`Все поля тикета #${card.id}`}
              className="secondary"
              trigger={
                <>
                  <Database size={17} /> Все поля
                </>
              }
            >
              <div className="ticket-all-fields">
                <dl>
                  {Object.entries(f).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd className="ticket-prose">{text(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </PrInfoPopup>
          </div>
        </aside>
        <div className="ticket-detail-main">
          <header className="ticket-card-header">
            <div className="ticket-card-title">
              <strong>{f["System.Title"]}</strong>
              <TicketCopyButton
                key={`url:${card.url}`}
                value={card.url}
                label="Скопировать ссылку на тикет в Azure DevOps"
                link
              />
            </div>
            <nav className="ticket-card-actions" aria-label="Действия тикета">
              <Link to={ticketPath(card.id, card.source)}>
                <ArrowUpRight size={15} />
                Перейти к тикету
              </Link>
              <a href={card.url} target="_blank" rel="noreferrer">
                <ExternalLink size={15} />
                Открыть в Azure DevOps
              </a>
              {card.locallyTracked && (
                <button
                  type="button"
                  className="secondary ticket-remove-button"
                  disabled={removing}
                  title="Переместить в локальную корзину на 30 дней. Azure не изменяется."
                  onClick={async () => {
                    if (removalPending.current) return;
                    removalPending.current = true;
                    setRemoving(true);
                    setRemovalError("");
                    try {
                      await api(`/tickets/${card.id}`, "DELETE", {
                        source: card.source,
                      });
                      setRemoved(true);
                      window.dispatchEvent(
                        new CustomEvent("orbit:ticket-removed", {
                          detail: { id: card.id, source: card.source },
                        }),
                      );
                    } catch (e: any) {
                      setRemovalError(e.message);
                    } finally {
                      removalPending.current = false;
                      setRemoving(false);
                    }
                  }}
                >
                  {removing ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Trash2 size={15} />
                  )}
                  {removing ? "Удаляю…" : "Удалить"}
                </button>
              )}
              <button
                type="button"
                className="ticket-analyze-button"
                disabled={analyzing}
                onClick={async () => {
                  if (analysisPending.current) return;
                  analysisPending.current = true;
                  setAnalyzing(true);
                  setAnalysisError("");
                  try {
                    await openTicketAnalysis(reference);
                  } catch (e: any) {
                    setAnalysisError(e.message);
                  } finally {
                    analysisPending.current = false;
                    setAnalyzing(false);
                  }
                }}
              >
                {analyzing ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <Sparkles size={17} />
                )}
                Analyze with AI
              </button>
            </nav>
          </header>
          <div className="ticket-card-body">
            {analysisError && (
              <p className="error" role="alert">
                {analysisError}
              </p>
            )}
            {removed && (
              <p className="success-note" role="status">
                Тикет перемещён в локальную корзину на 30 дней. В Azure ничего
                не изменилось.
              </p>
            )}
            {removalError && (
              <p className="error" role="alert">
                {removalError}
              </p>
            )}
            {card.warnings.map((w: string) => (
              <p className="error" key={w}>
                {w}
              </p>
            ))}
            {[
              ["System.Description", "Описание"],
              ["Microsoft.VSTS.TCM.ReproSteps", "Шаги воспроизведения"],
              ["Microsoft.VSTS.Common.AcceptanceCriteria", "Критерии приёмки"],
            ]
              .filter(([key]) => f[key])
              .map(([key, label]) => (
                <details
                  className={`ticket-section ticket-section-resizable${key === "Microsoft.VSTS.Common.AcceptanceCriteria" ? " ticket-section-acceptance" : key === "System.Description" ? " ticket-section-description" : ""}`}
                  key={key}
                  open
                >
                  <summary>
                    {key === "System.Description" ? (
                      <FileText size={17} aria-hidden="true" />
                    ) : key === "Microsoft.VSTS.TCM.ReproSteps" ? (
                      <Bug size={17} aria-hidden="true" />
                    ) : (
                      <ListChecks size={17} aria-hidden="true" />
                    )}
                    {label}
                  </summary>
                  <TicketSectionScroll label={label}>
                    <TicketRichText
                      value={f[key]}
                      card={card}
                      reference={reference}
                    />
                  </TicketSectionScroll>
                </details>
              ))}
            <details
              className="ticket-section ticket-section-prs"
              open={!!card.linkedPullRequests?.length}
            >
              <summary>
                <GitPullRequest size={17} aria-hidden="true" />
                Связанные открытые PR{" "}
                <span className="ticket-count">
                  {card.linkedPullRequests?.length || 0}
                </span>
              </summary>
              {card.linkedPullRequests?.length ? (
                <ul className="ticket-linked-prs">
                  {card.linkedPullRequests.map((pr: any) => (
                    <li key={`${pr.monitor}:${pr.repo}:${pr.number}`}>
                      <div className="ticket-linked-pr-heading">
                        <span className="ticket-type-badge">PR</span>
                        <Link to={pullRequestPath(pr)}>
                          #{pr.number} · {pr.title}
                        </Link>
                        {pr.draft ? (
                          <span className="ticket-state-badge">Черновик</span>
                        ) : null}
                      </div>
                      <small>
                        {pr.author || "Автор не указан"} · {pr.client} /{" "}
                        {pr.project} · Синхронизация: {timestamp(pr.synced_at)}
                      </small>
                      {pr.syncError && (
                        <p className="error">
                          Последняя синхронизация не удалась: статус PR может
                          быть устаревшим.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ticket-empty">
                  Связанные открытые PR не найдены среди синхронизированных
                  репозиториев.
                </p>
              )}
              <p className="ticket-footnote">
                Ручные локальные связи и упоминания #номера в описании PR.
                Открытость — по последней синхронизации с учётом настроенного
                фильтра ревьюеров.
              </p>
            </details>
            <details className="ticket-section ticket-section-neutral">
              <summary>
                <MessageSquare size={17} aria-hidden="true" />
                Комментарии{" "}
                <span className="ticket-count">{card.comments.length}</span>
              </summary>
              {card.comments.length ? (
                <div className="ticket-comments">
                  {card.comments.map((c: any) => (
                    <article className="ticket-comment" key={c.id}>
                      <header>
                        <span className="ticket-comment-author">
                          <InitialsAvatar name={c.author || ""} />
                          <strong>{c.author || "Автор не указан"}</strong>
                        </span>
                        <time dateTime={c.date || undefined}>
                          {timestamp(c.date)}
                        </time>
                      </header>
                      <TicketRichText
                        value={c.richText || c.text}
                        card={card}
                        reference={reference}
                      />
                    </article>
                  ))}
                </div>
              ) : (
                <p className="ticket-empty">
                  Комментарии отсутствуют в загруженных данных.
                </p>
              )}
              <TicketCommentForm key={reference} reference={reference} />
            </details>
            <details className="ticket-section ticket-section-neutral">
              <summary>
                <Paperclip size={17} aria-hidden="true" />
                Вложения и изображения{" "}
                <span className="ticket-count">{card.attachments.length}</span>
              </summary>
              {card.attachments.length ? (
                <div className="ticket-attachments">
                  {card.attachments.map((a: any) => (
                    <div className="ticket-attachment" key={a.id}>
                      {a.image ? (
                        <>
                          <ImagePreview
                            src={attachmentUrl(a)}
                            alt={a.name}
                            thumbnail={false}
                          >
                            {a.name}
                          </ImagePreview>
                          <ImagePreview
                            src={attachmentUrl(a)}
                            alt={a.name}
                            className="ticket-attachment-preview"
                          />
                        </>
                      ) : (
                        <a
                          href={attachmentUrl(a)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {a.name} ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ticket-empty">
                  Вложения отсутствуют в загруженных данных.
                </p>
              )}
              {!!card.attachments.length && (
                <p className="ticket-footnote">
                  Картинки показаны вам; модель получает текст и список
                  вложений, а не пиксели изображения.
                </p>
              )}
            </details>
          </div>
        </div>
      </div>
    </article>
  );
}

function TicketCopyButton({
  value,
  label,
  link = false,
}: {
  value: string;
  label: string;
  link?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);
  const message =
    status === "copied"
      ? "Скопировано"
      : status === "error"
        ? "Не удалось скопировать. Проверьте доступ к буферу обмена."
        : label;
  return (
    <span className="ticket-copy-control">
      <button
        type="button"
        className="icon-button ticket-copy-button"
        title={message}
        aria-label={message}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setStatus("copied");
          } catch {
            setStatus("error");
          }
        }}
      >
        {status === "copied" ? (
          <Check size={16} />
        ) : link ? (
          <Link2 size={16} />
        ) : (
          <Copy size={16} />
        )}
      </button>
      <span className="ticket-copy-feedback" role="status">
        {status !== "idle" ? message : ""}
      </span>
    </span>
  );
}

function TicketCommentForm({ reference }: { reference: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const sending = useRef(false);
  const inputId = useId();
  return (
    <form
      className="ticket-comment-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (sending.current || !text.trim()) return;
        sending.current = true;
        setBusy(true);
        setError("");
        setSent(false);
        try {
          const result = await api(
            `/ticket-cards/${encodeURIComponent(reference)}/comments`,
            "POST",
            { text },
          );
          window.dispatchEvent(
            new CustomEvent("orbit:ticket-comment", { detail: result }),
          );
          setText("");
          setSent(true);
        } catch (e: any) {
          setError(e.message);
        } finally {
          sending.current = false;
          setBusy(false);
        }
      }}
    >
      <label htmlFor={inputId}>Новый комментарий</label>
      <textarea
        id={inputId}
        rows={4}
        maxLength={10000}
        value={text}
        disabled={busy}
        placeholder="Напишите комментарий к тикету…"
        onChange={(event) => {
          setText(event.target.value);
          setSent(false);
        }}
      />
      <div className="ticket-comment-form-actions">
        <small className="muted">
          Комментарий будет отправлен в Azure DevOps.
        </small>
        <button
          type="submit"
          className="primary"
          disabled={busy || !text.trim()}
        >
          <Send size={15} />
          {busy ? "Отправка…" : "Отправить"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {sent && <p role="status">Комментарий отправлен.</p>}
    </form>
  );
}

export function TicketTableRow({
  id,
  children,
  onRemove,
  highlighted = false,
  actions,
  columns = 7,
  hideActions = false,
  columnOrder = [],
}: {
  actions?: ReactNode;
  columns?: number;
  hideActions?: boolean;
  columnOrder?: string[];
  highlighted?: boolean;
  onRemove?: () => void;
  id: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(highlighted);
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (!highlighted) return;
    setOpen(true);
    const frame = requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      rowRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [highlighted]);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    let active = true;
    setReference("");
    setError("");
    api(`/tickets/${encodeURIComponent(id)}/details`)
      .then((result) => {
        if (active) setReference(result.cardId);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [open, id, attempt]);
  return (
    <>
      <tr
        ref={rowRef}
        id={`ticket-${id}`}
        tabIndex={0}
        aria-expanded={open}
        aria-controls={panelId}
        className={`ticket-clickable-row${highlighted ? " ticket-row-highlighted" : ""}`}
        onClick={(event) => {
          const target = event.target;
          if (
            !(target instanceof Element) ||
            target.closest(
              'button, a, input, label, select, textarea, summary, dialog, [role="button"], [role="checkbox"], [contenteditable], [data-row-click-ignore]',
            ) ||
            window.getSelection()?.toString()
          )
            return;
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
      >
        <OrderedTicketCells order={columnOrder}>
          {children}
          <td data-column="actions" hidden={hideActions}>
            <div className="ticket-row-actions">
              {actions}
              <button
                type="button"
                className="secondary"
                aria-expanded={open}
                aria-controls={panelId}
                aria-label={`${open ? "Скрыть" : "Посмотреть"} тикет #${id}`}
                title={open ? "Скрыть тикет" : "Посмотреть тикет"}
                onClick={() => setOpen(!open)}
              >
                {open ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
              {onRemove && (
                <button
                  type="button"
                  className="text-button"
                  aria-label={`Убрать тикет #${id} из локального списка`}
                  onClick={onRemove}
                  title="Удалить только из Orbit; автоимпорт не вернёт тикет"
                >
                  <Trash2 size={17} />
                </button>
              )}
            </div>
          </td>
        </OrderedTicketCells>
      </tr>
      <tr id={panelId} hidden={!open} className="ticket-preview-row">
        <td colSpan={columns}>
          {open && (
            <section aria-label={`Карточка тикета #${id}`}>
              {error ? (
                <div className="stack">
                  <p className="error" role="alert">
                    {error}
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setAttempt(attempt + 1)}
                  >
                    Повторить загрузку
                  </button>
                </div>
              ) : reference ? (
                <TicketCard reference={reference} />
              ) : (
                <p role="status">Загрузка тикета #{id}…</p>
              )}
            </section>
          )}
        </td>
      </tr>
    </>
  );
}
