import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { api } from "./api.js";
import { InitialsAvatar } from "./InitialsAvatar.js";
import { LocalAssigneeNames } from "./LocalAssigneeNames.js";

type Person = { id: string; name: string; email: string };
export function AzureAssignee({ ticket, onChange }: any) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null | undefined>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPeople([]);
    setTruncated(false);
    if (query.trim().length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      api("/developers/search", "POST", { query: query.trim() })
        .then((result) => {
          if (live) {
            setPeople(result.users);
            setTruncated(result.truncated);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, open]);
  return (
    <div className="local-developer">
      <span className="local-developer-name">
        <LocalAssigneeNames
          names={ticket.assigned ? [ticket.assigned] : []}
          emptyLabel="Не назначен"
        />
      </span>
      <button
        type="button"
        className="text-button ticket-cell-button ticket-field-edit-trigger"
        title="Изменить исполнителя в Azure"
        aria-label={`Изменить исполнителя Azure #${ticket.id}`}
        onClick={() => {
          setQuery("");
          setSelected(undefined);
          setError("");
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <Pencil size={15} />
      </button>
      <dialog
        ref={dialog}
        className="developer-dialog local-assignment-dialog"
        aria-label={`Исполнитель Azure #${ticket.id}`}
        onClose={() => setOpen(false)}
        onCancel={(e) => {
          e.stopPropagation();
          if (busy) e.preventDefault();
        }}
      >
        <div className="developer-dialog-heading">
          <strong>Исполнитель Azure · #{ticket.id}</strong>
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
        <p className="muted">
          Сохранение изменит исполнителя тикета в Azure DevOps. Локальное
          поручение останется прежним.
        </p>
        <input
          aria-label="Поиск пользователей Azure"
          placeholder="Имя, фамилия или e-mail · от 2 символов"
          maxLength={100}
          value={query}
          disabled={busy}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="multi-select-options">
          <label className="local-developer-option">
            <input
              type="radio"
              name={`azure-assignee-${ticket.id}`}
              checked={selected === null}
              disabled={busy}
              onChange={() => setSelected(null)}
            />
            <span>Не назначен</span>
          </label>
          {people.map((person) => (
            <label className="local-developer-option" key={person.id}>
              <input
                type="radio"
                name={`azure-assignee-${ticket.id}`}
                checked={selected?.id === person.id}
                disabled={busy || !person.email}
                onChange={() => setSelected(person)}
              />
              <InitialsAvatar name={person.name} />
              <span className="local-developer-option-name">
                {person.name}
                <small>{person.email || "Нет уникального аккаунта"}</small>
              </span>
            </label>
          ))}
          {loading && <p role="status">Поиск в Azure…</p>}
          {!loading && query.trim().length >= 2 && !people.length && !error && (
            <p>Пользователи не найдены. Попробуйте фамилию или e-mail.</p>
          )}
          {truncated && (
            <p className="muted">
              Показаны первые 20 пользователей. Уточните запрос.
            </p>
          )}
        </div>
        {selected !== undefined && (
          <p>
            Выбрано: <strong>{selected?.name || "Не назначен"}</strong>
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button
          type="button"
          className="primary"
          disabled={busy || selected === undefined}
          onClick={async () => {
            if (busy || selected === undefined) return;
            setBusy(true);
            setError("");
            try {
              const result = await api(
                `/tickets/${ticket.id}/assignee`,
                "PUT",
                { source: ticket.source, userId: selected?.id || null },
              );
              window.dispatchEvent(
                new CustomEvent("orbit:ticket-assignee", { detail: result }),
              );
              dialog.current?.close();
              onChange?.();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Сохраняю и проверяю…" : "Сохранить в Azure"}
        </button>
      </dialog>
    </div>
  );
}
