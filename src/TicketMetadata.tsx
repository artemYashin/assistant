import { useEffect, useRef, useState } from "react";
import { NotebookPen, Pencil, X } from "lucide-react";
import { api } from "./api.js";
import { LocalTagsEditor } from "./LocalTagsEditor.js";

export function TicketMetadata({
  ticket,
  context,
  field,
  onChange,
  showLabel = false,
}: {
  ticket: any;
  context: { client: string; project: string };
  field: "notes" | "priority" | "tags";
  onChange: () => void;
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = { notes: "Заметки", priority: "Локальный приоритет", tags: "Теги" }[
    field
  ];
  return (
    <div className="ticket-metadata-control">
      {field === "priority" && (
        <span className="badge ticket-priority-badge">
          {ticket.priority ?? 1}
        </span>
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
        className={
          showLabel
            ? "secondary ticket-notes-trigger"
            : `icon-button ticket-cell-button${field !== "notes" ? " ticket-field-edit-trigger" : ticket.notes ? " has-ticket-notes" : ""}`
        }
        aria-label={label + " тикета #" + ticket.id}
        title={
          label + (field === "notes" && ticket.notes ? " · есть запись" : "")
        }
        onClick={() => setOpen(true)}
      >
        {field === "notes" ? (
          <NotebookPen size={17} fill={showLabel && ticket.notes ? "#e0eada" : "none"} />
        ) : (
          <Pencil size={14} />
        )}
        {showLabel && <span>{label}</span>}
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
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog
      ref={ref}
      className="developer-dialog ticket-metadata-dialog"
      aria-label={label + " тикета #" + ticket.id}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
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
          <label>
            Локальный приоритет (1 — самый высокий)
            <input type="number" min={1} step={1} max={Number.MAX_SAFE_INTEGER} required
              value={value} onChange={e => setValue(e.target.value)} disabled={busy} />
          </label>
        ) : field === "tags" ? (
          <LocalTagsEditor value={value} onChange={setValue} source={ticket.source} disabled={busy} />
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
          <button className="primary" disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
