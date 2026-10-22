import { MemoryMarkdown } from "./MemoryMarkdown.js";
import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { api } from "./api.js";

export function MemoryProposalContent({ summary, body, collapsible = false }: { summary: string; body: string; collapsible?: boolean }) {
  return (
    <div className="memory-proposal-fields">
      <section className="memory-proposal-field" aria-label="Название">
        <div className="memory-proposal-field-label">Название</div>
        <strong className="memory-summary">{summary}</strong>
      </section>
      {collapsible ? <details className="memory-proposal-field memory-description">
        <summary>Описание</summary>
        <MemoryMarkdown body={body} />
      </details> : <section className="memory-proposal-field" aria-label="Описание">
        <div className="memory-proposal-field-label">Описание</div>
        <MemoryMarkdown body={body} />
      </section>}
    </div>
  );
}

export function MemoryBody({
  id,
  body,
  summary,
  disabled,
  onSaved,
  proposal = false,
  onEditingChange,
  actions,
}: {
  id: string;
  body: string;
  summary: string;
  disabled: boolean;
  onSaved: () => void;
  proposal?: boolean;
  actions?: import("react").ReactNode;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [short, setShort] = useState(summary);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!editing)
    return (
      <>
        <MemoryProposalContent summary={summary} body={body} collapsible />
        <div className="memory-edit-actions">
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => {
            setDraft(body);
            setShort(summary);
            setError("");
            setEditing(true);
            onEditingChange?.(true);
          }}
        >
          <Pencil size={15} /> Редактировать
        </button>
        {actions}
        </div>
      </>
    );
  return (
    <form
      className="memory-edit-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || disabled) return;
        setBusy(true);
        setError("");
        try {
          await api(`/${proposal ? "memory-proposals" : "memories"}/${id}`, "PATCH", { body: draft, summary: short });
          onSaved();
          setEditing(false);
          onEditingChange?.(false);
        } catch (e: any) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>Название · 1–2 предложения<input value={short} onChange={event => setShort(event.target.value)} maxLength={320} required disabled={busy} /></label>
      <label>
        Описание · Markdown
        <textarea
          autoFocus
          rows={5}
          value={draft}
          maxLength={8000}
          required
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="card-actions">
        <button
          className="primary"
          disabled={busy || disabled || !draft.trim() || !short.trim()}
        >
          <Check size={15} /> {busy ? "Сохраняю…" : "Сохранить"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => { setEditing(false); onEditingChange?.(false); }}
        >
          <X size={15} /> Отмена
        </button>
      </div>
    </form>
  );
}
