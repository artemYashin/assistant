import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History, MessageSquare, Plus, X } from "lucide-react";
import { api } from "./api.js";

type Context = { client: string; project: string };
export function ChatHistory({
  context,
  activeId,
  disabled,
  onSelect,
}: {
  context: Context;
  activeId: string;
  disabled: boolean;
  onSelect: (id?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const key = JSON.stringify(context);
  useEffect(() => setOpen(false), [key]);
  return (
    <>
      <button
        type="button"
        className="icon-button assistant-chats-button"
        title="История чатов"
        aria-label="История чатов"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <History size={18} /><span>Чаты</span>
      </button>
      {open &&
        createPortal(
          <ChatHistoryDialog
            context={context}
            activeId={activeId}
            onClose={() => setOpen(false)}
            onSelect={onSelect}
          />,
          document.body,
        )}
    </>
  );
}
function ChatHistoryDialog({
  context,
  activeId,
  onClose,
  onSelect,
}: {
  context: Context;
  activeId: string;
  onClose: () => void;
  onSelect: (id?: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    let active = true;
    api(`/conversation/sessions?${new URLSearchParams(context)}`)
      .then((result) => {
        if (active) setSessions(result.sessions);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function select(id?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSelect(id);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="chat-history-dialog"
      aria-label="История чатов"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>История чатов</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть историю чатов"
          disabled={busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </header>
      <p className="muted">
        {[context.client, context.project].filter(Boolean).join(" / ") ||
          "Общий контекст"}
      </p>
      <button
        type="button"
        className="secondary chat-new-button"
        disabled={busy || loading}
        onClick={() => void select()}
      >
        <Plus size={17} /> Новый чат
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Загружаю чаты…</p>
      ) : (
        <div className="chat-history-list">
          {sessions.map((session) => (
            <button
              type="button"
              key={session.id}
              className={`chat-history-item${session.id === activeId ? " is-active" : ""}`}
              aria-current={session.id === activeId ? "true" : undefined}
              disabled={busy}
              onClick={() => void select(session.id)}
            >
              <MessageSquare size={18} />
              <span>
                <strong>{session.title}</strong>
                <small>
                  {new Date(session.updated_at).toLocaleString("ru-RU")} ·
                  Сообщений: {session.messageCount}
                  {session.id === activeId ? " · Текущий" : ""}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </dialog>
  );
}
