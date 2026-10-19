import { useEffect, useState, useId, type ReactNode } from "react";
import { api } from "./api.js";
// Render external content as text, never inject work item HTML into the page.
function text(value: any) {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const textarea = document.createElement("textarea");
  textarea.innerHTML = raw.replace(/<[^>]*>/g, " ");
  return textarea.value;
}
export function TicketCard({ reference }: { reference: string }) {
  const [card, setCard] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
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
  return (
    <details className="ticket-detail" open>
      <summary>
        <b>
          #{card.id} · {f["System.Title"]}
        </b>
      </summary>
      <p>
        {f["System.WorkItemType"]} · {f["System.State"]} ·{" "}
        {f["System.AssignedTo"]?.displayName ||
          f["System.AssignedTo"]?.uniqueName ||
          ""}
      </p>
      <small>
        Получено {new Date(card.loadedAt).toLocaleString("ru-RU")} ·{" "}
        {card.project}
      </small>
      <p>
        <a href={card.url} target="_blank" rel="noreferrer">
          Открыть в Azure DevOps
        </a>
      </p>
      {card.warnings.map((w: string) => (
        <p className="error" key={w}>
          {w}
        </p>
      ))}
      {[
        "System.Description",
        "Microsoft.VSTS.TCM.ReproSteps",
        "Microsoft.VSTS.Common.AcceptanceCriteria",
      ]
        .filter((k) => f[k])
        .map((k) => (
          <section key={k}>
            <h4>
              {k === "System.Description"
                ? "Описание"
                : k.endsWith("ReproSteps")
                  ? "Шаги воспроизведения"
                  : "Критерии приёмки"}
            </h4>
            <p style={{ whiteSpace: "pre-wrap" }}>{text(f[k])}</p>
          </section>
        ))}
      <details>
        <summary>Все поля тикета</summary>
        {Object.entries(f).map(([k, v]) => (
          <div key={k}>
            <b>{k}</b>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {text(v)}
            </p>
          </div>
        ))}
      </details>
      <h4>Комментарии ({card.comments.length})</h4>
      {card.comments.map((c: any) => (
        <section
          key={c.id}
          style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}
        >
          <b>{c.author}</b>{" "}
          <small>
            {c.date ? new Date(c.date).toLocaleString("ru-RU") : ""}
          </small>
          <p style={{ whiteSpace: "pre-wrap" }}>{c.text}</p>
        </section>
      ))}
      <h4>Вложения и изображения ({card.attachments.length})</h4>
      {card.attachments.map((a: any) => (
        <div key={a.id}>
          <a href={attachmentUrl(a)} target="_blank" rel="noreferrer">
            {a.name}
          </a>
          {a.image && (
            <img
              src={attachmentUrl(a)}
              loading="lazy"
              alt={a.name}
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: 500,
                objectFit: "contain",
                margin: "10px 0",
              }}
              onError={(e) => {
                e.currentTarget.alt =
                  "Предпросмотр недоступен — откройте вложение по ссылке";
              }}
            />
          )}
        </div>
      ))}
      <small>
        Картинки показаны вам; в текущем режиме модель получает текст и список
        вложений, а не пиксели изображения.
      </small>
    </details>
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
}: {
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
        </td>
      </tr>
      <tr id={panelId} hidden={!open} className="ticket-preview-row">
        <td colSpan={5}>
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
