import { useEffect, useRef, useState } from "react";
import { NotebookPen, Pencil, X } from "lucide-react";
import { api } from "./api.js";
import { SingleSelect } from "./SingleSelect.js";

export function TicketMetadata({
  ticket,
  context,
  field,
  onChange,
}: {
  ticket: any;
  context: { client: string; project: string };
  field: "notes" | "priority" | "tags";
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label = { notes: "Заметки", priority: "Приоритет", tags: "Теги" }[
    field
  ];
  return (
    <div className="ticket-metadata-control">
      {field === "priority" && (
        <span className="badge">P{ticket.priority ?? 1}</span>
      )}
      {field === "tags" && (
        <span
          className="ticket-tag-list"
          title={(ticket.tags || []).join(", ")}
        >
          {ticket.tags?.length ? (
            ticket.tags.map((tag: string) => (
              <span className="badge" key={tag}>
                {tag}
              </span>
            ))
          ) : (
            <span className="muted">—</span>
          )}
        </span>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={label + " тикета #" + ticket.id}
        title={
          label + (field === "notes" && ticket.notes ? " · есть запись" : "")
        }
        onClick={() => setOpen(true)}
      >
        {field === "notes" ? (
          <NotebookPen size={17} fill={ticket.notes ? "#e0eada" : "none"} />
        ) : (
          <Pencil size={14} />
        )}
      </button>
      {open && (
        <Editor
          ticket={ticket}
          context={context}
          field={field}
          label={label}
          onClose={() => setOpen(false)}
          onChange={onChange}
        />
      )}
    </div>
  );
}
function Editor({ ticket, context, field, label, onClose, onChange }: any) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(
    field === "tags"
      ? (ticket.tags || []).join("\n")
      : String(ticket[field] ?? (field === "priority" ? 1 : "")),
  );
  const [count, setCount] = useState(3),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    let live = true;
    api("/ticket-priorities?" + new URLSearchParams(context))
      .then((v) => {
        if (live) {
          setCount(v.count);
          setReady(true);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="developer-dialog ticket-metadata-dialog"
      aria-label={label + " тикета #" + ticket.id}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="developer-dialog-heading">
        <h2>
          {label} · #{ticket.id}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        Только в Orbit. В Azure эти данные не отправляются.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const patch = {
              [field]:
                field === "priority"
                  ? Number(value)
                  : field === "tags"
                    ? value
                        .split("\n")
                        .map((s: string) => s.trim())
                        .filter(Boolean)
                    : value,
            };
            const saved = await api(
              "/tickets/" + ticket.id + "/metadata",
              "PUT",
              {
                source: ticket.source,
                context,
                patch,
              },
            );
            window.dispatchEvent(
              new CustomEvent("orbit:ticket-metadata", {
                detail: { id: ticket.id, source: ticket.source, value: saved },
              }),
            );
            onChange();
            onClose();
          } catch (e: any) {
            setError(e.message);
            setBusy(false);
          }
        }}
      >
        {field === "priority" ? (
          <SingleSelect
            label="Приоритет (1 — самый высокий)"
            value={value}
            onChange={setValue}
            disabled={!ready || busy}
            options={Array.from(
              { length: Math.max(count, Number(value)) },
              (_, i) => ({
                value: String(i + 1),
                label:
                  "P" +
                  (i + 1) +
                  (i + 1 > count ? " — вне настроенного диапазона" : ""),
              }),
            )}
          />
        ) : (
          <label>
            {field === "tags"
              ? "По одному тегу на строку (до 30)"
              : "Ваши заметки"}
            <textarea
              rows={field === "notes" ? 12 : 6}
              maxLength={field === "notes" ? 20000 : 1830}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="card-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button className="primary" disabled={busy || !ready}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function PrioritySettings({ context }: any) {
  const [count, setCount] = useState("3"),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    api("/ticket-priorities?" + new URLSearchParams(context))
      .then((v) => {
        if (live) {
          setCount(String(v.count));
          setReady(true);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [context.client, context.project]);
  async function save(inherit = false) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const v = await api("/ticket-priorities", "PUT", {
        context,
        count: inherit ? null : Number(count),
      });
      setCount(String(v.count));
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="context-manager-section">
      <h3>Приоритеты тикетов</h3>
      <p className="muted">
        {context.project
          ? "Настройки текущего проекта; без переопределения наследуются от заказчика."
          : "Настройки заказчика для его проектов."}{" "}
        По умолчанию 3 уровня, новый тикет — P1. P1 — самый высокий. Сохранённые
        приоритеты при уменьшении диапазона не теряются.
      </p>
      <SingleSelect
        label="Количество уровней"
        value={count}
        onChange={(v) => {
          setCount(v);
          setSaved(false);
        }}
        disabled={busy || !ready}
        options={Array.from({ length: 19 }, (_, i) => ({
          value: String(i + 2),
          label: String(i + 2),
        }))}
      />
      <div className="card-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !ready}
          onClick={() => void save()}
        >
          Сохранить
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !ready}
          onClick={() => void save(true)}
        >
          Сбросить переопределение
        </button>
      </div>
      {saved && <p role="status">Сохранено</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
