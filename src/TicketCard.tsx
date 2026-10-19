import { StatusBadge } from "./TicketControls.js";
import { useEffect, useState, useId, type ReactNode } from "react";
import { api } from "./api.js";
// Render external content as text, never inject work item HTML into the page.
function text(value: any) {
  const raw = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  const textarea = document.createElement("textarea");
  textarea.innerHTML = raw
    .replace(/<br\s*\/?\s*>|<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return textarea.value;
}
export function TicketCard({ reference }: { reference: string }) {
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
    let live = true;
    setCard(null);
    setError("");
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
      <header className="ticket-card-title">
        <span className="ticket-number">#{card.id}</span>
        <strong>{f["System.Title"]}</strong>
      </header>
      <div className="ticket-card-body">
        <div className="ticket-badges">
          <span className="ticket-type-label">Тип задачи</span>
          <StatusBadge
            state={f["System.WorkItemType"] || "Тип не указан"}
            colors={typeColors}
            kind="type"
          />
          <StatusBadge
            state={f["System.State"] || "Статус не указан"}
            colors={colors}
          />
          <span className="ticket-project">{card.project}</span>
        </div>
        <dl className="ticket-metadata">
          <div>
            <dt>Автор</dt>
            <dd>{person(f["System.CreatedBy"])}</dd>
          </div>
          <div>
            <dt>Исполнитель</dt>
            <dd>
              {f["System.AssignedTo"]
                ? person(f["System.AssignedTo"])
                : "Не назначен"}
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
        </dl>
        <div className="ticket-source">
          <span>Данные получены: {timestamp(card.loadedAt)}</span>
          <a href={card.url} target="_blank" rel="noreferrer">
            Открыть в Azure DevOps ↗
          </a>
        </div>
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
            <details className="ticket-section" key={key} open>
              <summary>{label}</summary>
              <p className="ticket-prose">{text(f[key])}</p>
            </details>
          ))}
        <details className="ticket-section">
          <summary>
            Комментарии{" "}
            <span className="ticket-count">{card.comments.length}</span>
          </summary>
          {card.comments.length ? (
            <div className="ticket-comments">
              {card.comments.map((c: any) => (
                <article className="ticket-comment" key={c.id}>
                  <header>
                    <strong>{c.author || "Автор не указан"}</strong>
                    <time dateTime={c.date || undefined}>
                      {timestamp(c.date)}
                    </time>
                  </header>
                  <p className="ticket-prose">{c.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="ticket-empty">
              Комментарии отсутствуют в загруженных данных.
            </p>
          )}
        </details>
        <details className="ticket-section">
          <summary>
            Вложения и изображения{" "}
            <span className="ticket-count">{card.attachments.length}</span>
          </summary>
          {card.attachments.length ? (
            <div className="ticket-attachments">
              {card.attachments.map((a: any) => (
                <div className="ticket-attachment" key={a.id}>
                  <a href={attachmentUrl(a)} target="_blank" rel="noreferrer">
                    {a.name} ↗
                  </a>
                  {a.image && (
                    <img
                      src={attachmentUrl(a)}
                      loading="lazy"
                      alt={a.name}
                      onError={(e) => {
                        e.currentTarget.alt =
                          "Предпросмотр недоступен — откройте вложение по ссылке";
                      }}
                    />
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
              Картинки показаны вам; модель получает текст и список вложений, а
              не пиксели изображения.
            </p>
          )}
        </details>
        <details className="ticket-all-fields">
          <summary>Все поля тикета · {Object.keys(f).length}</summary>
          <dl>
            {Object.entries(f).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd className="ticket-prose">{text(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </article>
  );
}

export function TicketLookup() {
  const [id, setId] = useState(""),
    [ref, setRef] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel ticket-lookup">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result = await api(
              `/tickets/${encodeURIComponent(id)}/details`,
            );
            setRef(result.cardId);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Открыть полную карточку по номеру
          <input
            type="number"
            min={1}
            required
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <button className="secondary" disabled={busy}>
          {busy ? "Загрузка…" : "Показать тикет"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {ref && <TicketCard reference={ref} />}
    </section>
  );
}

export function TicketTableRow({
  id,
  children,
  onRemove,
}: {
  onRemove?: () => void;
  id: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
      <tr>
        {children}
        <td>
          <button
            type="button"
            className="secondary"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? "Скрыть" : "Посмотреть"} тикет #${id}`}
            onClick={() => setOpen(!open)}
          >
            {open ? "Скрыть" : "Посмотреть"}
          </button>
          {onRemove && (
            <button
              type="button"
              className="text-button"
              onClick={onRemove}
              title="Удалить только из Orbit; автоимпорт не вернёт тикет"
            >
              Убрать из списка
            </button>
          )}
        </td>
      </tr>
      <tr id={panelId} hidden={!open} className="ticket-preview-row">
        <td colSpan={6}>
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
