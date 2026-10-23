import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export function PrInfoPopup({
  title,
  trigger,
  children,
  onOpenChange,
  className = "icon-button",
}: {
  title: string;
  trigger: ReactNode;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          onOpenChange?.(true);
        }}
      >
        {trigger}
      </button>
      {open && (
        <Popup
          title={title}
          onClose={() => {
            setOpen(false);
            onOpenChange?.(false);
          }}
        >
          {children}
        </Popup>
      )}
    </>
  );
}
function Popup({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="developer-dialog pr-info-popup"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="developer-dialog-heading">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
