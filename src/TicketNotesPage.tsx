import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { api } from "./api.js";
import { TicketNoteForm } from "./TicketNoteForm.js";
import { ticketPath } from "./routing.js";
const key = (t: any) => JSON.stringify([t.source, t.id]);
const statuses: Record<string, string> = {
  added: "Добавлен",
  deleted: "Удалён · в корзине",
  not_imported: "Не импортирован",
};
export function TicketNotesPage() {
  const [items, setItems] = useState<any[]>([]),
    [visited, setVisited] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
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
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="notes-layout">
        <aside className="notes-list" aria-label="Список заметок тикетов">
          {loading ? (
            <p>Загрузка…</p>
          ) : (
            !items.length && (
              <p className="muted">Пока нет тикетов с заметками.</p>
            )
          )}
          {items.map((t) => (
            <button
              key={key(t)}
              disabled={busy}
              className={selected === key(t) ? "is-selected" : ""}
              onClick={() => {
                setSelected(key(t));
                setVisited((old) =>
                  old.some((v) => key(v) === key(t)) ? old : [...old, t],
                );
              }}
            >
              <strong>
                #{t.id} {t.title}
              </strong>
              <small>
                {statuses[t.localStatus]}
                {t.state ? " · " + t.state : ""}
              </small>
            </button>
          ))}
        </aside>
        <div className="notes-content">
          {!selected && (
            <p className="muted">
              Выберите тикет слева. Здесь собраны заметки всех проектов.
            </p>
          )}
          {visited.map((t) => (
            <div key={key(t)} hidden={selected !== key(t)}>
              <div className="ticket-note-heading">
                <h2>
                  #{t.id} {t.title}
                </h2>
                <span className={"badge note-status-" + t.localStatus}>
                  {statuses[t.localStatus]}
                </span>
                <Link className="secondary" to={ticketPath(t.id, t.source)}>
                  <ExternalLink size={15} />
                  Открыть тикет
                </Link>
              </div>
              <TicketNoteForm
                ticket={t}
                embedded
                onBusy={setBusy}
                onSaved={() => void load()}
                onClose={() => {}}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
