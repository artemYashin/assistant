import { analysisChatReadyEvent } from "./chat-ticket-analysis.js";
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
  const [selection, setSelection] = useState<{ id: number; title: string }[]>([]);
  const source = useRef("");
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
    setSelection([]);
    setCardRef("");
    setBusy(false);
    setError("");
  };
  async function selectTicket(ticketId: number) {
    const current = ++request.current;
    setId(String(ticketId)); setCardRef(""); setBusy(true); setError("");
    try {
      const result = await api(`/tickets/${ticketId}/details?${new URLSearchParams({ source: source.current })}`);
      if (current === request.current) {
        if (result.source !== source.current) throw new Error("Подключение Azure изменилось");
        setCardRef(result.cardId);
      }
    } catch (e: any) { if (current === request.current) setError(e.message); }
    finally { if (current === request.current) setBusy(false); }
  }
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!Array.isArray(detail?.tickets) || !detail.tickets.length || typeof detail.source !== "string") return;
      const tickets = detail.tickets.filter((t: any) => Number.isSafeInteger(t.id) && t.id > 0 && typeof t.title === "string").slice(0, 50);
      if (!tickets.length) return;
      source.current = detail.source;
      setSelection(tickets); setOpen(true); dialog.current?.showModal();
      void selectTicket(tickets[0].id);
    };
    window.addEventListener("orbit-show-ticket-details", show);
    return () => window.removeEventListener("orbit-show-ticket-details", show);
  }, []);
  // Internal links should reveal their destination rather than return to lookup.
  useEffect(() => {
    dialog.current?.close();
    reset();
  }, [location.key]);
  useEffect(() => {
    const close = () => {
      dialog.current?.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach(child => child.close());
      reset();
      dialog.current?.close();
    };
    window.addEventListener(analysisChatReadyEvent, close);
    window.addEventListener("orbit-close-ticket-details", close);
    return () => {
      window.removeEventListener(analysisChatReadyEvent, close);
      window.removeEventListener("orbit-close-ticket-details", close);
    };
  }, []);
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
    if (cardRef && !selection.length) setCardRef("");
    else {
      reset();
      dialog.current?.close();
    }
  };
  return (
    <>
      <button
        type="button"
        className="ticket-lookup-trigger"
        title="Открыть тикет по номеру"
        aria-label="Открыть тикет по номеру"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <Ticket size={19} />
        <span>Открыть тикет</span>
      </button>
      <dialog
        ref={dialog}
        className={`ticket-lookup-dialog${cardRef || selection.length ? " is-detail" : " is-lookup"}`}
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
            {selection.length > 1 ? `Тикеты · ${selection.length}` : cardRef || selection.length ? `Тикет #${id}` : "Открыть тикет по номеру"}
          </h2>
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            aria-label={
              cardRef && !selection.length
                ? "Закрыть деталку и вернуться к вводу номера"
                : "Закрыть поиск тикета"
            }
            title={cardRef && !selection.length ? "Вернуться к вводу номера" : "Закрыть"}
            onClick={backOrClose}
          >
            <X size={20} />
          </button>
        </header>
        {open &&
          (selection.length ? (
            <div className={`ticket-viewer-layout${selection.length === 1 ? " is-single" : ""}`}>
              {selection.length > 1 && <nav className="ticket-viewer-list" aria-label="Выбранные тикеты">
                {selection.map(ticket => <button type="button" key={ticket.id} aria-current={String(ticket.id) === id ? "true" : undefined} onClick={() => void selectTicket(ticket.id)}>
                  <Ticket size={16} aria-hidden="true" /><span><b>#{ticket.id}</b><span>{ticket.title}</span></span>
                </button>)}
              </nav>}
              <div className="ticket-viewer-content" aria-busy={busy}>
                {busy ? <p role="status">Загружаю тикет…</p> : error ? <div role="alert"><p>{error}</p><button className="secondary" onClick={() => void selectTicket(Number(id))}>Повторить</button></div> : cardRef ? <TicketCard key={cardRef} reference={cardRef} /> : null}
              </div>
            </div>
          ) : cardRef ? (
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
