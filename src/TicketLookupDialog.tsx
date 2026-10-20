import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Ticket, X } from "lucide-react";
import { TicketCard } from "./TicketCard.js";
import { api } from "./api.js";

export function TicketLookupDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [cardRef, setCardRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const location = useLocation();
  const reset = () => {
    request.current++;
    setOpen(false);
    setCardRef("");
    setBusy(false);
    setError("");
  };
  // Internal links should reveal their destination rather than return to lookup.
  useEffect(() => {
    dialog.current?.close();
    reset();
  }, [location.key]);
  useEffect(() => {
    if (!open) return;
    if (cardRef) closeButton.current?.focus({ preventScroll: true });
    else input.current?.focus({ preventScroll: true });
    if (dialog.current) dialog.current.scrollTop = 0;
  }, [open, cardRef]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const backOrClose = () => {
    if (cardRef) setCardRef("");
    else {
      reset();
      dialog.current?.close();
    }
  };
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
        className={`ticket-lookup-dialog${cardRef ? " is-detail" : " is-lookup"}`}
        aria-labelledby={titleId}
        onCancel={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          backOrClose();
        }}
        onClose={(event) => {
          // Nested edit dialogs must not close the lookup.
          if (event.target === event.currentTarget) reset();
        }}
      >
        <header className="ticket-lookup-dialog-heading">
          <h2 id={titleId}>
            {cardRef ? `Тикет #${id}` : "Открыть тикет по номеру"}
          </h2>
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            aria-label={
              cardRef
                ? "Закрыть деталку и вернуться к вводу номера"
                : "Закрыть поиск тикета"
            }
            title={cardRef ? "Вернуться к вводу номера" : "Закрыть"}
            onClick={backOrClose}
          >
            <X size={20} />
          </button>
        </header>
        {open &&
          (cardRef ? (
            <TicketCard reference={cardRef} />
          ) : (
            <section className="panel ticket-lookup">
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy) return;
                  const current = ++request.current;
                  setBusy(true);
                  setError("");
                  try {
                    const result = await api(
                      `/tickets/${encodeURIComponent(id)}/details`,
                    );
                    if (current === request.current) setCardRef(result.cardId);
                  } catch (e: any) {
                    if (current === request.current) setError(e.message);
                  } finally {
                    if (current === request.current) setBusy(false);
                  }
                }}
              >
                <label>
                  Номер тикета
                  <input
                    ref={input}
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={id}
                    disabled={busy}
                    onChange={(e) => setId(e.target.value)}
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  {busy ? "Загрузка…" : "Показать тикет"}
                </button>
              </form>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </section>
          ))}
      </dialog>
    </>
  );
}
