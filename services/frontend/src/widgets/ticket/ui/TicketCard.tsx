import { TicketLinkedPullRequests } from "./TicketLinkedPullRequests.js";
import { TicketHistory } from "./TicketHistory.js";
import { locateContentLink } from "../lib/locate-content-link.js";
import type { ContentLink } from "../../../features/render-content/index.js";
import { useMemo, useLayoutEffect } from "react";
import { contentLinkGroups, ExternalLinkBadge } from "../../../features/render-content/index.js";
import { useLocalManagement } from "../../../entities/work-mode/index.js";
import { MemoryMarkdown } from "../../../features/render-content/index.js";
import { TicketCommentForm } from "../../../features/comment-ticket/index.js";
import { ConfirmButton } from "../../../shared/ui/confirm-button/index.js";
import {
  findCitationRange,
  highlightCitation,
  revealCitation,
} from "../../../entities/ticket/index.js";
import { AzureAssignee } from "../../../features/edit-ticket/index.js";
import { ImagePreview } from "../../../entities/rich-content/preview/index.js";
import { openTicketAnalysis } from "../../../entities/chat/index.js";
import { PrInfoPopup } from "../../../shared/ui/info-popup/index.js";
import { TicketSectionScroll } from "../../../entities/ticket/index.js";
import { OrderedTicketCells } from "../../../features/ticket-columns/index.js";
import { TicketMetadata } from "../../../features/edit-ticket/index.js";
import { InitialsAvatar } from "../../../shared/ui/initials-avatar/index.js";
import { LocalAssigneeNames } from "../../../entities/developer/index.js";
import { Link } from "react-router-dom";
import { ticketPath } from "../../../shared/config/routes/index.js";
import {
  History,
  Sparkles,
  LocateFixed,
  ArchiveRestore,
  Download,
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
} from "lucide-react";
import { TicketRichText } from "../../../features/render-content/index.js";
import { LocalDeveloper, TicketStatus } from "../../../features/edit-ticket/index.js";
import { StatusBadge } from "../../../entities/ticket/index.js";
import { useEffect, useState, useId, useRef, type ReactNode } from "react";
import { api } from "../../../shared/api/http/index.js";
import { ticketText as text } from "../../../entities/ticket/index.js";
const ticketContentSections = [
  ["System.Description", "Описание"],
  ["Microsoft.VSTS.TCM.ReproSteps", "Шаги воспроизведения"],
  ["Microsoft.VSTS.Common.AcceptanceCriteria", "Критерии приёмки"],
];

export function TicketCard({
  reference,
  citation,
}: {
  reference: string;
  citation?: { section: string; quote: string };
}) {
  const citationRoot = useRef<HTMLDivElement>(null);
  const contentRoot = useRef<HTMLDivElement>(null);
  const tabId = useId();
  const [prsOpened, setPrsOpened] = useState(false);
  const [prCount, setPrCount] = useState<number | null>(null);
  const [historyOpened, setHistoryOpened] = useState(false);
  const [activeTab, setActiveTab] = useState("content");
  const tabScroll = useRef<Record<string, number>>({});
  const changeTab = (tab: string) => {
    if (contentRoot.current) tabScroll.current[activeTab] = contentRoot.current.scrollTop;
    setActiveTab(tab);
    if (tab === "prs") setPrsOpened(true);
    if (tab === "history") setHistoryOpened(true);
  };
  useLayoutEffect(() => {
    if (contentRoot.current) contentRoot.current.scrollTop = tabScroll.current[activeTab] || 0;
  }, [activeTab]);
  const [imageSelection, setImageSelection] = useState<{ image: HTMLElement } | null>(null);
  const [imageError, setImageError] = useState("");
  useEffect(() => {
    if (!imageSelection) return;
    const { image } = imageSelection;
    const frame = requestAnimationFrame(() => {
      for (let node: HTMLElement | null = image; node; node = node.parentElement) {
        if (node instanceof HTMLDetailsElement) node.open = true;
        if (node === contentRoot.current) break;
      }
      image.scrollIntoView({ block: "center" });
      image.classList.add("ticket-image-target");
    });
    return () => {
      cancelAnimationFrame(frame);
      image.classList.remove("ticket-image-target");
    };
  }, [imageSelection]);
  function showImage(url: string) {
    const image = [
      ...(contentRoot.current?.querySelectorAll<HTMLAnchorElement>(
        "[data-link-source] a.image-preview-trigger",
      ) || []),
    ].find((node) => node.getAttribute("href") === url);
    setImageError(
      image
        ? ""
        : "Изображение не найдено в описании или комментариях. Оно доступно только как вложение.",
    );
    if (!image) return;
    changeTab("content");
    setImageSelection({ image });
  }
  const [linkSelection, setLinkSelection] = useState<{ link: ContentLink } | null>(null);
  const [linkError, setLinkError] = useState("");
  useEffect(() => {
    setActiveTab("content");
    setHistoryOpened(false);
    setPrsOpened(false);
    setPrCount(null);
    tabScroll.current = {};
    setImageSelection(null);
    setImageError("");
    setLinkSelection(null);
    setLinkError("");
  }, [reference]);
  const [citationMissing, setCitationMissing] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const trackingPending = useRef(false);
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
  const management = useLocalManagement();
  const [card, setCard] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!card || !citation || !citationRoot.current) return;
    setActiveTab("content");
    const section = [
      ...citationRoot.current.querySelectorAll<HTMLDetailsElement>(
        "details[data-citation-section]",
      ),
    ].find((node) => node.dataset.citationSection === citation.section);
    if (!section) {
      setCitationMissing(true);
      return;
    }
    section.open = true;
    const range = findCitationRange(section, citation.quote);
    setCitationMissing(!range);
    if (!range) return;
    const clearHighlight = highlightCitation(range);
    const frame = requestAnimationFrame(() => revealCitation(range));
    return () => {
      cancelAnimationFrame(frame);
      clearHighlight();
    };
  }, [card, citation]);
  useEffect(() => {
    if (!linkSelection || !card || !contentRoot.current) return;
    setLinkError("");
    const range = locateContentLink(contentRoot.current, linkSelection.link, card.base || card.url);
    if (!range) {
      setLinkError(
        "Не удалось найти ссылку в текущем содержимом тикета. Возможно, оно изменилось.",
      );
      return;
    }
    const clearHighlight = highlightCitation(range);
    const frame = requestAnimationFrame(() => {
      range.startContainer.parentElement?.scrollIntoView({ block: "center" });
      revealCitation(range);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearHighlight();
    };
  }, [linkSelection, card]);
  useEffect(() => {
    const update = (event: Event) => {
      const { id, source, comment, attachments = [] } = (event as CustomEvent).detail;
      setCard((old: any) =>
        old?.id === id && old?.source === source
          ? {
              ...old,
              attachments: [
                ...new Map(
                  [...(old.attachments || []), ...attachments].map((image: any) => [
                    image.id,
                    image,
                  ]),
                ).values(),
              ],
              comments: [...old.comments.filter((c: any) => c.id !== comment.id), comment],
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
          ? { ...old, localMetadata: { ...old.localMetadata, ...value } }
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
          ? { ...old, locallyTracked: false, locallyAvailable: true }
          : old,
      );
    };
    window.addEventListener("orbit:ticket-removed", remove);
    return () => window.removeEventListener("orbit:ticket-removed", remove);
  }, []);
  useEffect(() => {
    let live = true;
    const tracked = (event: Event) => {
      const { id, source } = (event as CustomEvent).detail;
      if (card?.id !== id || card?.source !== source) return;
      api(`/ticket-cards/${encodeURIComponent(reference)}`)
        .then((value) => {
          if (live) {
            setCard(value);
            setRemoved(false);
          }
        })
        .catch((e) => {
          if (live) setTrackingError(e.message);
        });
    };
    window.addEventListener("orbit:ticket-tracked", tracked);
    return () => {
      live = false;
      window.removeEventListener("orbit:ticket-tracked", tracked);
    };
  }, [reference, card?.id, card?.source]);
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
  const linkGroups = useMemo(
    () =>
      card
        ? contentLinkGroups(
            [
              ...ticketContentSections.map(([key, title]) => ({
                title,
                value: card.fields[key],
                source: key,
                markdown: card.markdownFields?.includes(key),
              })),
              ...(card.comments || []).map((comment: any, index: number) => ({
                title: `Комментарий ${index + 1}${comment.author ? ` · ${comment.author}` : ""}`,
                value: comment.richText || comment.text,
                source: `comment:${comment.id}`,
              })),
            ],
            card.base || card.url,
          )
        : [],
    [card],
  );
  const linkCount = linkGroups.reduce((count, group) => count + group.links.length, 0);
  if (error) return <p className="error">{error}</p>;
  if (!card) return <p>Загрузка карточки…</p>;
  const f = card.fields;
  const azureTags = [
    ...new Set(
      String(f["System.Tags"] || "")
        .split(";")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  const attachmentUrl = (a: any) =>
    `/api/ticket-cards/${encodeURIComponent(reference)}/attachments/${encodeURIComponent(a.id)}`;
  const person = (value: any) =>
    typeof value === "string" ? value : value?.displayName || value?.uniqueName || "Не указан";
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
    <article
      className="ticket-detail"
      data-viewed-ticket-id={card.id}
      data-viewed-ticket-source={card.source}
    >
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
                <InitialsAvatar name={f["System.CreatedBy"] ? person(f["System.CreatedBy"]) : ""} />
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
                    assigned: f["System.AssignedTo"] ? person(f["System.AssignedTo"]) : "",
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
                <dt>Локальный дедлайн</dt>
                <dd>
                  {card.locallyAvailable || card.locallyTracked ? (
                    <TicketMetadata
                      ticket={{ id: card.id, source: card.source, ...card.localMetadata }}
                      context={card.localContext}
                      field="localDeadline"
                      onChange={() => {}}
                    />
                  ) : (
                    "—"
                  )}
                </dd>
                <dt>Локальный приоритет</dt>
                <dd>
                  {card.locallyAvailable || card.locallyTracked ? (
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
                      {card.localMetadata.priority}
                    </span>
                  )}
                </dd>
              </div>
            )}
            {management && (
              <div>
                <dt>Локальное поручение</dt>
                <dd>
                  {card.locallyAvailable || card.locallyTracked ? (
                    <LocalDeveloper ticket={card} context={card.localContext} />
                  ) : (
                    <LocalAssigneeNames names={(card.developers || []).map((d: any) => d.name)} />
                  )}
                </dd>
              </div>
            )}
            <div className="ticket-overview-tags">
              <dt>Теги</dt>
              <dd>
                {card.locallyAvailable || card.locallyTracked ? (
                  <TicketMetadata
                    ticket={{
                      id: card.id,
                      source: card.source,
                      ...card.localMetadata,
                    }}
                    context={card.localContext}
                    field="tags"
                    onChange={() => {}}
                  />
                ) : card.localMetadata?.tags?.length ? (
                  card.localMetadata.tags.map((tag: string) => (
                    <span className="badge" key={tag}>
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="muted">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Azure приоритет</dt>
              <dd title="Приоритет Azure DevOps · только чтение">
                {card.fields?.["Microsoft.VSTS.Common.Priority"] ?? "—"}
              </dd>
            </div>
            <div className="ticket-overview-tags">
              <dt>Azure теги</dt>
              <dd title="Теги Azure DevOps · только чтение">
                {azureTags.length ? (
                  azureTags.map((tag) => (
                    <span className="badge azure-ticket-tag" key={tag}>
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="muted">—</span>
                )}
              </dd>
            </div>
          </dl>
          <div className="ticket-sidebar-actions">
            {card.locallyAvailable || card.locallyTracked ? (
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
                <MemoryMarkdown body={card.localMetadata?.notes || "Локальных заметок пока нет."} />
                <p className="muted">Для редактирования добавьте тикет в локальный список.</p>
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
          {card.cacheFallback && (
            <div className="ticket-cache-notice" role="status">
              <Database size={16} aria-hidden="true" />
              <div>
                <strong>Не удалось загрузить тикет из Azure — показываем из кэша</strong>
                <small>
                  {card.cacheFallback.savedAt
                    ? `Сохранённые данные от ${new Date(card.cacheFallback.savedAt).toLocaleString("ru-RU")}. `
                    : ""}
                  Данные могут быть неполными или устаревшими. Изображения и файлы по-прежнему
                  загружаются из Azure.
                </small>
              </div>
            </div>
          )}
          {!card.locallyTracked && (
            <div className="ticket-tracking-action">
              <button
                type="button"
                disabled={tracking}
                onClick={async () => {
                  if (trackingPending.current) return;
                  trackingPending.current = true;
                  setTracking(true);
                  setTrackingError("");
                  try {
                    if (card.locallyAvailable) {
                      await api(`/tickets/${card.id}/restore`, "POST", {
                        source: card.source,
                      });
                    } else {
                      const result = await api("/azure/tickets/import", "POST", {
                        source: card.source,
                        ids: [card.id],
                      });
                      if (result.missing?.includes(card.id))
                        throw new Error(
                          "Не удалось импортировать тикет. Проверьте доступ к нему в Azure.",
                        );
                    }
                    setCard((old: any) => ({
                      ...old,
                      locallyTracked: true,
                      locallyAvailable: true,
                    }));
                    setRemoved(false);
                    window.dispatchEvent(
                      new CustomEvent("orbit:ticket-tracked", {
                        detail: { id: card.id, source: card.source },
                      }),
                    );
                  } catch (e: any) {
                    setTrackingError(e.message);
                  } finally {
                    trackingPending.current = false;
                    setTracking(false);
                  }
                }}
              >
                {tracking ? (
                  <LoaderCircle size={16} className="spin" />
                ) : card.locallyAvailable ? (
                  <ArchiveRestore size={16} />
                ) : (
                  <Download size={16} />
                )}
                {card.locallyAvailable ? "Восстановить" : "Импортировать"}
              </button>
              <span className="muted">
                {card.locallyAvailable
                  ? "Тикет находится в локальной корзине"
                  : "Тикет ещё не добавлен в локальный список"}
              </span>
            </div>
          )}
          {trackingError && (
            <p className="error" role="alert">
              {trackingError}
            </p>
          )}
          <header className="ticket-card-header">
            <div className="ticket-card-title">
              <TicketCopyButton
                key={`url:${card.url}`}
                value={card.url}
                label="Скопировать ссылку на тикет в Azure DevOps"
                link
              />
              <strong>{f["System.Title"]}</strong>
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
                  {removing ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}
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
                {analyzing ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}
                Analyze with AI
              </button>
            </nav>
          </header>
          <div
            className="ticket-detail-tabs"
            role="tablist"
            aria-label="Разделы тикета"
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
              ];
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                      buttons.length;
              event.preventDefault();
              buttons[next]?.focus();
              buttons[next]?.click();
            }}
          >
            {[
              { id: "content", label: "Содержание", icon: FileText },
              {
                id: "prs",
                label: "Связанные PR",
                icon: GitPullRequest,
                count:
                  prCount ??
                  new Set(
                    [...(card.linkedPullRequests || []), ...(card.azurePullRequests || [])].map(
                      (pr: any) => `${pr.repo.toLowerCase()}:${pr.number}`,
                    ),
                  ).size,
              },
              { id: "links", label: "Ссылки", icon: Link2, count: linkCount },
              {
                id: "attachments",
                label: "Вложения",
                icon: Paperclip,
                count: card.attachments.length,
              },
              { id: "history", label: "История", icon: History },
            ].map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                type="button"
                className={`ticket-detail-tab ticket-detail-tab-${id}`}
                role="tab"
                id={tabId + "-" + id}
                aria-controls={tabId + "-panel-" + id}
                aria-selected={activeTab === id}
                tabIndex={activeTab === id ? 0 : -1}
                onClick={() => changeTab(id)}
              >
                <Icon size={15} />
                {label}
                {count !== undefined && <span className="ticket-count">{count}</span>}
              </button>
            ))}
          </div>
          <div ref={contentRoot} className="ticket-card-body">
            <section
              role="tabpanel"
              id={tabId + "-panel-history"}
              aria-labelledby={tabId + "-history"}
              hidden={activeTab !== "history"}
            >
              {historyOpened && <TicketHistory key={reference} reference={reference} />}
            </section>
            {analysisError && (
              <p className="error" role="alert">
                {analysisError}
              </p>
            )}
            {removed && (
              <p className="success-note" role="status">
                Тикет перемещён в локальную корзину на 30 дней. В Azure ничего не изменилось.
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
            <div
              ref={citationRoot}
              className="ticket-citation-sections"
              role="tabpanel"
              id={tabId + "-panel-content"}
              aria-labelledby={tabId + "-content"}
              hidden={activeTab !== "content"}
            >
              {citationMissing && (
                <p role="status" className="muted">
                  Точный фрагмент не найден в текущей версии тикета. Возможно, текст изменился.
                </p>
              )}
              {ticketContentSections
                .filter(([key]) => f[key])
                .map(([key, label]) => (
                  <details
                    className={`ticket-section ticket-section-resizable${key === "Microsoft.VSTS.Common.AcceptanceCriteria" ? " ticket-section-acceptance" : key === "System.Description" ? " ticket-section-description" : ""}`}
                    key={key}
                    data-link-source={key}
                    data-citation-section={
                      key === "System.Description"
                        ? "description"
                        : key === "Microsoft.VSTS.TCM.ReproSteps"
                          ? "repro"
                          : "criteria"
                    }
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
                        markdown={card.markdownFields?.includes(key)}
                        card={card}
                        reference={reference}
                      />
                    </TicketSectionScroll>
                  </details>
                ))}
              <details className="ticket-section ticket-section-neutral ticket-comments-section">
                <summary>
                  <MessageSquare size={17} aria-hidden="true" />
                  Комментарии <span className="ticket-count">{card.comments.length}</span>
                </summary>
                {card.comments.length ? (
                  <div className="ticket-comments">
                    {card.comments.map((c: any) => (
                      <article
                        className="ticket-comment"
                        key={c.id}
                        data-link-source={`comment:${c.id}`}
                      >
                        <header>
                          <span className="ticket-comment-author">
                            <InitialsAvatar name={c.author || ""} />
                            <strong>{c.author || "Автор не указан"}</strong>
                          </span>
                          <time dateTime={c.date || undefined}>{timestamp(c.date)}</time>
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
                  <p className="ticket-empty">Комментарии отсутствуют в загруженных данных.</p>
                )}
                <TicketCommentForm
                  key={reference}
                  reference={reference}
                  draftKey={JSON.stringify([card.source, card.id])}
                />
              </details>
            </div>
            <section
              className="ticket-tab-panel ticket-section-neutral"
              role="tabpanel"
              id={tabId + "-panel-prs"}
              aria-labelledby={tabId + "-prs"}
              hidden={activeTab !== "prs"}
            >
              {prsOpened && (
                <TicketLinkedPullRequests
                  key={reference}
                  reference={reference}
                  onCount={setPrCount}
                />
              )}
            </section>

            {
              <section
                className="ticket-tab-panel ticket-section-neutral"
                role="tabpanel"
                id={tabId + "-panel-links"}
                aria-labelledby={tabId + "-links"}
                hidden={activeTab !== "links"}
              >
                {linkError && (
                  <p className="error" role="status">
                    {linkError}
                  </p>
                )}
                {!linkCount && (
                  <p className="ticket-empty">Ссылки отсутствуют в загруженных данных.</p>
                )}
                <nav className="ticket-content-links" aria-label="Ссылки из содержимого тикета">
                  {linkGroups.map((group) => (
                    <section
                      className="ticket-link-group"
                      key={group.source}
                      aria-label={group.title}
                    >
                      <h4>{group.title}</h4>
                      <ul>
                        {group.links.map((link) => (
                          <li className="ticket-content-link" key={link.url}>
                            <ExternalLinkBadge href={link.url}>{link.label}</ExternalLinkBadge>
                            <button
                              type="button"
                              className="chat-link-copy"
                              title="Показать в тикете"
                              aria-label="Показать в тикете"
                              onClick={() => {
                                changeTab("content");
                                setLinkSelection({ link });
                              }}
                            >
                              <LocateFixed size={13} aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </nav>
              </section>
            }
            <section
              className="ticket-tab-panel ticket-section-neutral"
              role="tabpanel"
              id={tabId + "-panel-attachments"}
              aria-labelledby={tabId + "-attachments"}
              hidden={activeTab !== "attachments"}
            >
              {imageError && (
                <p className="error" role="status">
                  {imageError}
                </p>
              )}
              {card.attachments.length ? (
                <div className="ticket-attachments">
                  {card.attachments.map((a: any) => (
                    <div className="ticket-attachment" key={a.id}>
                      {a.image ? (
                        <>
                          <button
                            type="button"
                            className="secondary ticket-attachment-locate"
                            title="Показать в тикете"
                            aria-label={`Показать изображение в тикете: ${a.name}`}
                            onClick={() => showImage(attachmentUrl(a))}
                          >
                            <LocateFixed size={13} aria-hidden="true" />
                            Показать в тикете
                          </button>
                          <ImagePreview src={attachmentUrl(a)} alt={a.name} thumbnail={false}>
                            {a.name}
                          </ImagePreview>
                          <ImagePreview
                            src={attachmentUrl(a)}
                            alt={a.name}
                            className="ticket-attachment-preview"
                          />
                        </>
                      ) : (
                        <a href={attachmentUrl(a)} target="_blank" rel="noreferrer">
                          {a.name} ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ticket-empty">Вложения отсутствуют в загруженных данных.</p>
              )}
              {!!card.attachments.length && (
                <p className="ticket-footnote">
                  Картинки показаны вам; модель получает текст и список вложений, а не пиксели
                  изображения.
                </p>
              )}
            </section>
          </div>
        </div>
      </div>
    </article>
  );
}

export function TicketCopyButton({
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

export function TicketTableRow({
  tone,
  unavailable = false,
  id,
  children,
  onRemove,
  onRowActivate,
  rowSelected,
  highlighted = false,
  actions,
  columns = 7,
  hideActions = false,
  columnOrder = [],
}: {
  tone?: "new" | "trash";
  unavailable?: boolean;
  actions?: ReactNode;
  columns?: number;
  hideActions?: boolean;
  columnOrder?: string[];
  highlighted?: boolean;
  onRemove?: () => void;
  onRowActivate?: () => void;
  rowSelected?: boolean;
  id: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(highlighted);
  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);
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
    if (!open || unavailable) return;
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
  }, [open, id, attempt, unavailable]);
  return (
    <>
      <tr
        ref={rowRef}
        id={`ticket-${id}`}
        tabIndex={unavailable ? undefined : 0}
        aria-selected={rowSelected}
        aria-expanded={onRowActivate ? undefined : open}
        aria-controls={onRowActivate ? undefined : panelId}
        className={`${unavailable ? "ticket-azure-unimported" : "ticket-clickable-row"}${tone ? ` ticket-tone-${tone}` : ""}${highlighted ? " ticket-row-highlighted" : ""}`}
        onClick={(event) => {
          if (unavailable) return;
          const target = event.target;
          if (
            !(target instanceof Element) ||
            target.closest(
              'button, a, input, label, select, textarea, summary, dialog, [role="button"], [role="checkbox"], [contenteditable], [data-row-click-ignore]',
            ) ||
            window.getSelection()?.toString()
          )
            return;
          if (onRowActivate) onRowActivate();
          else setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (unavailable) return;
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (onRowActivate) onRowActivate();
            else setOpen((value) => !value);
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
                disabled={unavailable}
                aria-expanded={open}
                aria-controls={panelId}
                aria-label={`${open ? "Скрыть" : "Посмотреть"} тикет #${id}`}
                title={
                  unavailable
                    ? "Сначала импортируйте тикет"
                    : open
                      ? "Скрыть тикет"
                      : "Посмотреть тикет"
                }
                onClick={() => setOpen(!open)}
              >
                {open ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
              {onRemove && (
                <ConfirmButton
                  className="icon-button ticket-table-delete"
                  ariaLabel={`Удалить тикет #${id} из локального списка`}
                  title={`Удалить тикет #${id}?`}
                  message={`Тикет #${id} будет перемещён в локальную корзину на 30 дней. В Azure он останется. Автоимпорт не вернёт его в список; при необходимости тикет можно восстановить из корзины.`}
                  confirmLabel="Удалить в корзину"
                  onConfirm={onRemove}
                >
                  <Trash2 size={17} aria-hidden="true" />
                </ConfirmButton>
              )}
            </div>
          </td>
        </OrderedTicketCells>
      </tr>
      <tr
        id={panelId}
        hidden={!open}
        className={`ticket-preview-row${tone ? ` ticket-tone-${tone}` : ""}`}
      >
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
