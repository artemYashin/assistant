import { useEffect, useState } from "react";
import { RefreshCw, Ticket } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { StatusBadge } from "../../../entities/ticket/index.js";

import "./ticket-related-tickets.css";

const filterKey = "orbit.related-tickets.type";

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
  const [selectedType, setSelectedType] = useState<string | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(filterKey) || "null");
      return typeof saved === "string" ? saved : null;
    } catch {
      return null;
    }
  });
  function selectType(type: string | null) {
    setSelectedType(type);
    try {
      localStorage.setItem(filterKey, JSON.stringify(type));
    } catch {
      /* Storage is optional. */
    }
  }
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
  const types = [...new Set((data?.items || []).map((ticket) => ticket.type))];
  const activeType = selectedType !== null && types.includes(selectedType) ? selectedType : null;
  const visible = (data?.items || []).filter(
    (ticket) => activeType === null || ticket.type === activeType,
  );
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
        <>
          <div className="related-ticket-filters" role="group" aria-label="Типы связанных тикетов">
            <button
              type="button"
              aria-pressed={activeType === null}
              onClick={() => selectType(null)}
            >
              Все <span>{data.items.length}</span>
            </button>
            {types.map((type) => (
              <button
                type="button"
                key={type}
                aria-pressed={activeType === type}
                onClick={() => selectType(type)}
              >
                {type ? (
                  <StatusBadge kind="type" state={type} colors={typeColors} />
                ) : (
                  "Тип недоступен"
                )}
                <span>{data.items.filter((ticket) => ticket.type === type).length}</span>
              </button>
            ))}
          </div>
          <ul className="related-ticket-list">
            {visible.map((ticket) => (
              <li key={ticket.id + ":" + ticket.relation}>
                <button
                  type="button"
                  className="related-ticket-card"
                  disabled={!ticket.canOpen}
                  title={
                    ticket.canOpen
                      ? "Открыть тикет"
                      : ticket.unavailable
                        ? "Тикет недоступен в Azure"
                        : "Для открытия выберите проект Azure: " + ticket.project
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
                  <span className="related-ticket-title">
                    <Ticket size={16} />
                    <span>
                      <strong>#{ticket.id}</strong> {ticket.title}
                    </span>
                  </span>
                  <span className="related-ticket-badges">
                    {ticket.type && (
                      <StatusBadge kind="type" state={ticket.type} colors={typeColors} />
                    )}
                    {ticket.state && <StatusBadge state={ticket.state} colors={statusColors} />}
                    {ticket.unavailable && (
                      <span>Тикет удалён или недоступен с текущими правами Azure.</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {data && !data.items.length && <p className="ticket-empty">Связанные тикеты не найдены.</p>}
    </div>
  );
}
