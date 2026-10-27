import { useEffect, useState } from "react";
import { RefreshCw, Ticket } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { StatusBadge } from "../../../entities/ticket/index.js";

type Related = {
  id: number;
  title: string;
  relation: string;
  type: string;
  state: string;
  project: string;
  canOpen: boolean;
  unavailable: boolean;
};
export function TicketRelatedTickets({
  reference,
  typeColors,
  statusColors,
  onCount,
}: {
  reference: string;
  typeColors: Record<string, string>;
  statusColors: Record<string, string>;
  onCount: (count: number) => void;
}) {
  const [data, setData] = useState<{ source: string; items: Related[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    api<{ source: string; items: Related[] }>(
      `/ticket-cards/${encodeURIComponent(reference)}/related-tickets`,
    )
      .then((result) => {
        if (live) {
          setData(result);
          onCount(result.items.length);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [reference, version, onCount]);
  return (
    <div>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => setVersion((v) => v + 1)}
      >
        <RefreshCw size={15} /> Обновить связи
      </button>
      {busy && <p role="status">Загружаю связанные тикеты…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <ul className="ticket-linked-prs">
          {data.items.map((ticket) => (
            <li key={ticket.id + ":" + ticket.relation}>
              <div className="ticket-linked-pr-heading">
                <span className="ticket-type-badge">{ticket.relation}</span>
                <button
                  type="button"
                  className="secondary"
                  disabled={!ticket.canOpen}
                  title={
                    ticket.canOpen
                      ? "Открыть тикет"
                      : ticket.unavailable
                        ? "Тикет недоступен в Azure"
                        : "Для открытия выберите соответствующий проект Azure"
                  }
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("orbit-show-ticket-details", {
                        detail: {
                          source: data.source,
                          tickets: [{ id: ticket.id, title: ticket.title }],
                        },
                      }),
                    )
                  }
                >
                  <Ticket size={15} /> #{ticket.id} {ticket.title}
                </button>
                {ticket.type && <StatusBadge kind="type" state={ticket.type} colors={typeColors} />}
                {ticket.state && <StatusBadge state={ticket.state} colors={statusColors} />}
              </div>
              {ticket.project && <small>{ticket.project}</small>}
              {ticket.unavailable && (
                <p className="muted">Тикет удалён или недоступен с текущими правами Azure.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && !data.items.length && <p className="ticket-empty">Связанные тикеты не найдены.</p>}
    </div>
  );
}
