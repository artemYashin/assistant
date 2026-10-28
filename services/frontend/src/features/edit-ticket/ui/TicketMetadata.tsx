import { TicketNoteForm } from "./TicketNoteForm.js";
import { NumberInput } from "../../../shared/ui/number-input/index.js";
import { CalendarDateField } from "../../../entities/calendar/index.js";
import { fromWall, wallTime } from "../../../entities/calendar/index.js";
import { useEffect, useRef, useState } from "react";
import { NotebookPen, Pencil, X } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { TagsEditor } from "../../../shared/ui/tags-editor/index.js";
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
  field: "notes" | "priority" | "tags" | "localDeadline" | "azurePriority" | "azureTags";
  onChange: () => void;
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const deadline =
    field === "localDeadline" && ticket.localDeadline ? Date.parse(ticket.localDeadline) : NaN;
  const overdue = Number.isFinite(deadline) && deadline < now;
  useEffect(() => {
    if (!Number.isFinite(deadline)) return;
    setNow(Date.now());
    if (deadline < Date.now()) return;
    // Keep an open table up to date when a future deadline passes.
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (deadline < current) window.clearInterval(timer);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const label = {
    localDeadline: "Локальный дедлайн",
    notes: "Заметки",
    priority: "Локальный приоритет",
    tags: "Локальные теги",
    azurePriority: "Azure приоритет",
    azureTags: "Azure теги",
  }[field];
  return (
    <div className="ticket-metadata-control">
      {field === "localDeadline" && (
        <span
          className={`ticket-deadline-value${overdue ? " is-overdue" : ""}`}
          title={
            ticket.localDeadline
              ? `${overdue ? "Дедлайн просрочен · " : ""}${new Date(ticket.localDeadline).toLocaleString("ru-RU")}`
              : "Дедлайн не задан"
          }
        >
          {ticket.localDeadline ? (
            <>
              <span>
                {new Date(ticket.localDeadline).toLocaleDateString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "2-digit",
                })}
              </span>
              <small>
                {new Date(ticket.localDeadline).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
            </>
          ) : (
            "—"
          )}
        </span>
      )}
      {(field === "priority" || field === "azurePriority") && (
        <span className="badge ticket-priority-badge">
          {ticket[field] ?? (field === "priority" ? 1 : "—")}
        </span>
      )}
      {(field === "tags" || field === "azureTags") && (
        <span className="ticket-tag-list" title={(ticket[field] || []).join(", ")}>
          {ticket[field]?.length ? (
            ticket[field].map((tag: string) => (
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
        title={label + (field === "notes" && ticket.notes ? " · есть запись" : "")}
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
  const azure = field === "azureTags" || field === "azurePriority";
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [tagsError, setTagsError] = useState("");
  const [tagsLoading, setTagsLoading] = useState(field === "azureTags");
  useEffect(() => {
    if (field !== "azureTags") return;
    let live = true;
    api(`/azure/ticket-tags?${new URLSearchParams({ source: ticket.source })}`)
      .then((tags) => {
        if (live) setKnownTags(tags);
      })
      .catch((e) => {
        if (live) setTagsError(e.message);
      })
      .finally(() => {
        if (live) setTagsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [field, ticket.source]);
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(
    field === "localDeadline"
      ? ""
      : field === "tags" || field === "azureTags"
        ? (ticket[field] || []).join("\n")
        : String(ticket[field] ?? (field === "priority" ? 1 : "")),
  );
  const [zone, setZone] = useState("UTC");
  const [dateReady, setDateReady] = useState(field !== "localDeadline");
  useEffect(() => {
    if (field !== "localDeadline") return;
    let live = true;
    setDateReady(false);
    api("/settings")
      .then((s) => {
        if (!live) return;
        const z = s.syncSchedule.timeZone;
        setZone(z);
        setValue(ticket.localDeadline ? wallTime(ticket.localDeadline, z) : "");
        setDateReady(true);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [field, ticket.localDeadline]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
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
        {azure
          ? "Изменение будет сохранено в Azure DevOps. Локальные поля не изменятся."
          : "Только в Orbit. В Azure эти данные не отправляются."}
      </p>
      {field === "notes" ? (
        <TicketNoteForm ticket={ticket} onSaved={onChange} onClose={onClose} onBusy={setBusy} />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!dateReady) return;
            setBusy(true);
            setError("");
            try {
              const patch = {
                [field]:
                  field === "localDeadline"
                    ? value
                      ? ticket.localDeadline && value === wallTime(ticket.localDeadline, zone)
                        ? ticket.localDeadline
                        : fromWall(value, zone)
                      : null
                    : field === "priority" || field === "azurePriority"
                      ? Number(value)
                      : field === "tags" || field === "azureTags"
                        ? value
                            .split("\n")
                            .map((s: string) => s.trim())
                            .filter(Boolean)
                        : value,
              };
              if (azure) {
                const saved = await api(`/tickets/${ticket.id}/azure-fields`, "PUT", {
                  source: ticket.source,
                  patch,
                });
                window.dispatchEvent(
                  new CustomEvent("orbit:ticket-azure-fields", { detail: saved }),
                );
              } else {
                const saved = await api("/tickets/" + ticket.id + "/metadata", "PUT", {
                  source: ticket.source,
                  context,
                  patch,
                });
                window.dispatchEvent(
                  new CustomEvent("orbit:ticket-metadata", {
                    detail: { id: ticket.id, source: ticket.source, value: saved },
                  }),
                );
                window.dispatchEvent(new Event("orbit-calendar-changed"));
              }
              onChange();
              onClose();
            } catch (e: any) {
              setError(e.message);
              setBusy(false);
            }
          }}
        >
          {field === "localDeadline" ? (
            <CalendarDateField
              label="Локальный дедлайн"
              zone={zone}
              value={value}
              onChange={setValue}
              disabled={busy}
            />
          ) : field === "priority" || field === "azurePriority" ? (
            <label>
              {label} (1 — самый высокий)
              <NumberInput
                min={1}
                step={1}
                max={Number.MAX_SAFE_INTEGER}
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={busy}
              />
            </label>
          ) : field === "azureTags" ? (
            <TagsEditor
              label="Azure теги"
              known={knownTags}
              loading={tagsLoading}
              error={tagsError}
              forbidSemicolon
              maxTags={100}
              maxLength={400}
              value={value}
              onChange={setValue}
              disabled={busy}
            />
          ) : field === "tags" ? (
            <LocalTagsEditor
              value={value}
              onChange={setValue}
              source={ticket.source}
              disabled={busy}
            />
          ) : (
            <label>
              {field === "tags" ? "По одному тегу на строку (до 30)" : "Ваши заметки"}
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
            <button type="button" className="secondary" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button className="primary" disabled={busy || !dateReady}>
              {busy ? "Сохраняю…" : "Сохранить"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
