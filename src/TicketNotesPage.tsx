import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Ticket, ExternalLink } from "lucide-react";
import { api } from "./api.js";
import { TicketMetadata } from "./TicketMetadata.js";
import { MemoryMarkdown } from "./MemoryMarkdown.js";
import { ticketPath } from "./routing.js";
export function TicketNotesPage() {
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  async function load() {
    try {
      setItems(await api("/ticket-notes"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const listener = () => void load();
    window.addEventListener("orbit:ticket-metadata", listener);
    return () => window.removeEventListener("orbit:ticket-metadata", listener);
  }, []);
  return (
    <div className="ticket-notes-list">
      <p className="muted">
        Заметки тикетов всех проектов. Состояние показывает наличие тикета в
        Orbit, а не его статус в Azure.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading ? (
        <p>Загрузка…</p>
      ) : (
        !items.length && <p className="muted">Пока нет тикетов с заметками.</p>
      )}
      {items.map((t) => (
        <article className="ticket-note-card" key={t.source + ":" + t.id}>
          <div className="ticket-note-heading">
            <Ticket size={18} />
            <Link to={ticketPath(t.id, t.source)}>
              #{t.id} {t.title}
            </Link>
            <span className={"badge note-status-" + t.localStatus}>
              {
                (
                  {
                    added: "Добавлен",
                    deleted: "Удалён · в корзине",
                    not_imported: "Не импортирован",
                  } as Record<string, string>
                )[t.localStatus]
              }
            </span>
            {t.state && <span className="badge">{t.state}</span>}
          </div>
          <small className="muted">{t.source}</small>
          <MemoryMarkdown body={t.notes} />
          <div className="card-actions">
            <TicketMetadata
              ticket={t}
              context={{ client: "", project: "" }}
              field="notes"
              showLabel
              onChange={() => void load()}
            />
            <Link className="secondary" to={ticketPath(t.id, t.source)}>
              <ExternalLink size={15} />
              Открыть тикет
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
