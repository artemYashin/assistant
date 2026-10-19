import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Ticket, X } from "lucide-react";
import { TicketLookup } from "./TicketCard.js";

export function TicketLookupDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const location = useLocation();
  // Internal links in the ticket card must reveal the destination page.
  useEffect(() => {
    dialog.current?.close();
    setOpen(false);
  }, [location.key]);
  return (
    <>
      <button
        type="button"
        className="icon-button"
        title="Открыть тикет по номеру"
        aria-label="Открыть тикет по номеру"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <Ticket size={19} />
      </button>
      <dialog
        ref={dialog}
        className="ticket-lookup-dialog"
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
      >
        <header className="ticket-lookup-dialog-heading">
          <h2 id={titleId}>Открыть тикет по номеру</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть просмотр тикета"
            title="Закрыть"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </header>
        {open && <TicketLookup />}
      </dialog>
    </>
  );
}
