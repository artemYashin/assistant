import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function ConfirmButton({
  children,
  title,
  message,
  confirmLabel,
  onConfirm,
  disabled,
  ariaLabel,
  className = "secondary",
}: {
  children: ReactNode;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => unknown | Promise<unknown>;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        className={className}
        disabled={disabled || busy}
        onClick={() => {
          setError("");
          dialog.current?.showModal();
        }}
      >
        {children}
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <dialog
            ref={dialog}
            className="developer-dialog action-confirm-dialog"
            aria-label={title}
            onCancel={(event) => {
              event.stopPropagation();
              if (busy) event.preventDefault();
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget && !busy) {
                const rect = event.currentTarget.getBoundingClientRect();
                if (
                  event.clientX < rect.left ||
                  event.clientX > rect.right ||
                  event.clientY < rect.top ||
                  event.clientY > rect.bottom
                )
                  dialog.current?.close();
              }
            }}
          >
            <div className="developer-dialog-heading">
              <h2>{title}</h2>
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                onClick={() => dialog.current?.close()}
                aria-label="Закрыть"
              >
                <X size={18} />
              </button>
            </div>
            <p>{message}</p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                autoFocus
                disabled={busy}
                onClick={() => dialog.current?.close()}
              >
                Отмена
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  setError("");
                  try {
                    await onConfirm();
                    dialog.current?.close();
                  } catch (e: any) {
                    setError(e.message || "Не удалось выполнить действие");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Выполняю…" : confirmLabel}
              </button>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
