import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ticket as TicketIcon, Trash2, X } from "lucide-react";
import { StatusBadge } from "../../../entities/ticket/index.js";
import { api } from "../../../shared/api/http/index.js";

type Ticket = {
  id: number;
  title?: string;
  type?: string;
  state?: string;
  imported?: boolean;
  inTrash?: boolean;
};

export function BulkTicketTrash({
  tickets,
  source,
  disabled,
  typeColors,
  statusColors,
  onRemoved,
}: {
  tickets: Ticket[];
  source: string;
  disabled?: boolean;
  typeColors?: Record<string, string>;
  statusColors?: Record<string, string>;
  onRemoved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const lock = useRef(false);
  const [snapshot, setSnapshot] = useState<Ticket[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const eligible = tickets.filter((ticket) => ticket.imported !== false && !ticket.inTrash);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function remove() {
    if (lock.current || !snapshot.length) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const failed: Ticket[] = [];
    const errors: string[] = [];
    let removed = 0;
    for (const ticket of snapshot) {
      if (!active.current) break;
      try {
        await api(`/tickets/${ticket.id}`, "DELETE", { source });
        removed++;
      } catch (e: any) {
        failed.push(ticket);
        errors.push(`#${ticket.id}: ${e.message || "Не удалось перенести в корзину"}`);
      }
    }
    if (!active.current) return;
    setNotice(`Перенесено в корзину: ${removed} из ${snapshot.length}.`);
    setSnapshot(failed);
    setError(errors.join("\n"));
    setBusy(false);
    lock.current = false;
    if (!failed.length) dialog.current?.close();
    onRemoved();
  }
  return (
    <>
      <button
        type="button"
        className="secondary danger"
        disabled={disabled || busy || !eligible.length}
        title={!eligible.length ? "Выберите тикеты, добавленные в локальный список" : undefined}
        onClick={() => {
          setSnapshot([...eligible]);
          setSkipped(tickets.length - eligible.length);
          setError("");
          setNotice("");
          dialog.current?.showModal();
        }}
      >
        <Trash2 size={16} /> В корзину
        <span className="ticket-view-count">{eligible.length}</span>
      </button>
      {notice && (
        <span className="muted" role="status">
          {notice}
        </span>
      )}
      {typeof document !== "undefined" &&
        createPortal(
          <dialog
            ref={dialog}
            className="developer-dialog action-confirm-dialog bulk-ticket-trash-dialog"
            aria-label="Перенести выбранные тикеты в корзину?"
            onCancel={(event) => {
              event.stopPropagation();
              if (lock.current) event.preventDefault();
            }}
          >
            <div className="developer-dialog-heading">
              <h2>Перенести выбранные тикеты в корзину?</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Закрыть"
                disabled={busy}
                onClick={() => dialog.current?.close()}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              Будут перенесены в локальную корзину: {snapshot.length}. Тикеты останутся в Azure. В
              Orbit их можно восстановить в течение 30 дней.
            </p>
            {!!skipped && (
              <p className="muted">
                Не будут затронуты неимпортированные тикеты и уже находящиеся в корзине: {skipped}.
              </p>
            )}
            <ul className="bulk-ticket-trash-list">
              {snapshot.map((ticket) => (
                <li key={ticket.id}>
                  <TicketIcon size={14} aria-hidden="true" />
                  <strong>#{ticket.id}</strong>
                  <span className="bulk-ticket-trash-title" title={ticket.title}>
                    {ticket.title || "Название не загружено"}
                  </span>
                  <span className="bulk-ticket-trash-badges">
                    {ticket.type && (
                      <StatusBadge kind="type" state={ticket.type} colors={typeColors} />
                    )}
                    {ticket.state && <StatusBadge state={ticket.state} colors={statusColors} />}
                  </span>
                </li>
              ))}
            </ul>
            {error && (
              <p className="error" role="alert" style={{ whiteSpace: "pre-line" }}>
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                autoFocus
                disabled={busy}
                onClick={() => dialog.current?.close()}
              >
                Отмена
              </button>
              <button
                type="button"
                className="primary bulk-ticket-trash-confirm"
                disabled={busy || !snapshot.length}
                onClick={() => void remove()}
              >
                <Trash2 size={16} />
                {busy ? "Переношу…" : "Перенести в корзину"}
              </button>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
