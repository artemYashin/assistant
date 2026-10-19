import { useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { api } from "./api.js";
export function StatusBadge({
  state,
  colors = {},
  kind = "state",
}: {
  kind?: "state" | "type";
  state: string;
  colors?: Record<string, string>;
}) {
  const color = colors[state];
  return (
    <span
      className={`ticket-${kind}-badge`}
      style={
        color
          ? { color, background: color + "18", borderColor: color }
          : undefined
      }
    >
      {state}
    </span>
  );
}
export function LocalDeveloper({ ticket, onChange }: any) {
  const [query, setQuery] = useState(""),
    [people, setPeople] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [searched, setSearched] = useState(false),
    [truncated, setTruncated] = useState(false);
  const generation = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  async function search() {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setPeople([]);
    setSearched(false);
    try {
      const result = await api("/developers/search", "POST", {
        query: query.trim(),
      });
      if (current !== generation.current) return;
      setPeople(result.users);
      setTruncated(result.truncated);
      setSearched(true);
    } catch (e: any) {
      if (current === generation.current) setError(e.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function assign(developerId: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/tickets/${ticket.id}/developer`, "PUT", { developerId });
      setPeople([]);
      setQuery("");
      setSearched(false);
      dialog.current?.close();
      onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="local-developer">
      <span
        className="local-developer-name"
        title={ticket.developer_name || "Не поручено"}
      >
        {ticket.developer_name || "N/A"}
      </span>
      <button
        type="button"
        className="text-button"
        disabled={busy}
        aria-label={`Редактировать локальное поручение #${ticket.id}`}
        title="Редактировать локальное поручение"
        onClick={() => {
          setError("");
          dialog.current?.showModal();
        }}
      >
        <Pencil size={15} />
      </button>
      <button
        type="button"
        className="text-button"
        disabled={busy || !ticket.developer_id}
        aria-label={`Снять локальное поручение #${ticket.id}`}
        title="Снять локальное поручение"
        onClick={() => void assign("")}
      >
        <X size={15} />
      </button>
      <dialog
        ref={dialog}
        className="developer-dialog"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <div className="developer-dialog-heading">
          <strong>Локальное поручение · #{ticket.id}</strong>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            aria-label="Закрыть поиск разработчика"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <input
          aria-label={`Поиск разработчика #${ticket.id}`}
          placeholder="Имя или email · от 2 символов"
          value={query}
          maxLength={100}
          disabled={busy}
          onChange={(e) => {
            generation.current++;
            setQuery(e.target.value);
            setPeople([]);
            setSearched(false);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim().length >= 2 && !busy) {
              e.preventDefault();
              void search();
            }
          }}
        />
        <button
          type="button"
          className="text-button"
          disabled={busy || query.trim().length < 2}
          onClick={() => void search()}
        >
          {busy ? "Загрузка…" : "Найти в Azure"}
        </button>
        <small>
          Поиск по организации/коллекции. Назначение только локальное.
        </small>
        {!!people.length && (
          <ul className="developer-results">
            {people.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void assign(p.id)}
                >
                  <span>{p.name}</span>
                  {p.email && <small>{p.email}</small>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {searched && !people.length && (
          <small role="status">
            Никого не найдено. Попробуйте полное имя или email.
          </small>
        )}
        {searched && truncated && (
          <small role="status">
            Показаны первые 20 совпадений. Уточните запрос.
          </small>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </dialog>
      {error && !dialog.current?.open && (
        <small role="alert" className="error">
          {error}
        </small>
      )}
    </div>
  );
}
