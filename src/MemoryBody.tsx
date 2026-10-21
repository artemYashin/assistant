import { MemoryMarkdown } from "./MemoryMarkdown.js";
import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { api } from "./api.js";

export function MemoryBody({
  id,
  body,
  disabled,
  onSaved,
  proposal = false,
  onEditingChange,
}: {
  id: string;
  body: string;
  disabled: boolean;
  onSaved: () => void;
  proposal?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!editing)
    return (
      <>
        <MemoryMarkdown body={body} />
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => {
            setDraft(body);
            setError("");
            setEditing(true);
            onEditingChange?.(true);
          }}
        >
          <Pencil size={15} /> Редактировать
        </button>
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
          await api(`/${proposal ? "memory-proposals" : "memories"}/${id}`, "PATCH", { body: draft });
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
      <label>
        Текст памяти
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
          disabled={busy || disabled || !draft.trim()}
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
