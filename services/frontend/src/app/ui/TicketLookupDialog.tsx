import { StatusBadge } from "../../entities/ticket/index.js";
import { NumberInput } from "../../shared/ui/number-input/index.js";
import { useChatToggleShortcut as useAppShortcut } from "../../features/voice-input/index.js";
import { Fragment, useCallback, useLayoutEffect } from "react";
import { analysisChatReadyEvent } from "../../entities/chat/index.js";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft, ChevronRight, Ticket, X } from "lucide-react";
import { TicketCard } from "../../widgets/ticket/index.js";
import { api } from "../../shared/api/http/index.js";

type TicketView = {
  key: number;
  id: string;
  source: string;
  selection: { id: number; title: string; type?: string; state?: string }[];
  citation?: { section: string; quote: string };
  cardRef: string;
};

export function TicketLookupDialog({
  typeColors,
  statusColors,
  shortcutKey = "KeyT",
  shortcutPress = "single",
}: {
  typeColors?: Record<string, string>;
  statusColors?: Record<string, string>;
  shortcutKey?: string;
  shortcutPress?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const [selection, setSelection] = useState<
    { id: number; title: string; type?: string; state?: string }[]
  >([]);
  const source = useRef("");
  const nextKey = useRef(0);
  const [viewKey, setViewKey] = useState(0);
  const [history, setHistory] = useState<TicketView[]>([]);
  const currentView = useRef<TicketView | null>(null);
  const [citation, setCitation] = useState<{ section: string; quote: string } | undefined>();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [cardRef, setCardRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const location = useLocation();
  useLayoutEffect(() => {
    currentView.current = {
      key: viewKey,
      id,
      source: source.current,
      selection,
      citation,
      cardRef,
    };
  }, [viewKey, id, selection, citation, cardRef]);
  const reset = () => {
    request.current++;
    setOpen(false);
    setHistory([]);
    currentView.current = null;
    setSelection([]);
    setCitation(undefined);
    setCardRef("");
    setBusy(false);
    setError("");
  };
  const openLookup = useCallback(() => {
    setOpen(true);
    dialog.current?.showModal();
  }, []);
  useAppShortcut(shortcutKey, shortcutPress, openLookup);
  async function selectTicket(ticketId: number) {
    const current = ++request.current;
    setId(String(ticketId));
    setCardRef("");
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/tickets/${ticketId}/details?${new URLSearchParams({ source: source.current })}`,
      );
      if (current === request.current) {
        if (result.source !== source.current) throw new Error("Подключение Azure изменилось");
        setCardRef(result.cardId);
      }
    } catch (e: any) {
      if (current === request.current) setError(e.message);
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        !Array.isArray(detail?.tickets) ||
        !detail.tickets.length ||
        typeof detail.source !== "string"
      )
        return;
      const tickets = detail.tickets.filter(
        (t: any) => Number.isSafeInteger(t.id) && t.id > 0 && typeof t.title === "string",
      );
      if (!tickets.length) return;
      const previous = currentView.current;
      if (dialog.current?.open && previous?.cardRef) {
        if (
          previous.source === detail.source &&
          previous.id === String(tickets[0].id) &&
          tickets.length === 1
        ) {
          setCitation(detail.citation);
          return;
        }
        setHistory((items) => [...items, previous]);
      }
      setViewKey(++nextKey.current);
      source.current = detail.source;
      setCitation(detail.citation);
      setSelection(tickets);
      setOpen(true);
      dialog.current?.showModal();
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
      dialog.current
        ?.querySelectorAll<HTMLDialogElement>("dialog[open]")
        .forEach((child) => child.close());
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
  const goBack = (index = history.length - 1) => {
    const previous = history[index];
    if (!previous) return;
    request.current++;
    source.current = previous.source;
    setId(previous.id);
    setSelection(previous.selection);
    setCitation(previous.citation);
    setCardRef(previous.cardRef);
    setViewKey(previous.key);
    setBusy(false);
    setError("");
    setHistory((items) => items.slice(0, index));
  };
  const backOrClose = () => {
    if (history.length) {
      goBack();
      return;
    }
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
        onClick={openLookup}
      >
        <Ticket size={19} />
        <span>Открыть тикет</span>
      </button>
      <dialog
        ref={dialog}
        className={`ticket-lookup-dialog${selection.length > 1 ? " is-multiple" : ""}${cardRef || selection.length ? " is-detail" : " is-lookup"}`}
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented) return;
          if (
            !(event.target instanceof Element) ||
            event.target.closest("dialog") !== event.currentTarget
          )
            return;
          // Consecutive native Escape requests may become non-cancelable in Chrome.
          // Route through the same cancel guards without losing the navigation stack.
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat)
            event.currentTarget.dispatchEvent(new Event("cancel", { cancelable: true }));
        }}
        onCancel={(event) => {
          if (event.target !== event.currentTarget || event.defaultPrevented) return;
          // The inline creation form owns cancellation (and guards pending writes).
          if (
            event.currentTarget.querySelector(
              ".ticket-lookup-frame:not([hidden]) .ticket-related-create-panel",
            )
          )
            return;
          event.preventDefault();
          backOrClose();
        }}
        onClose={(event) => {
          // Nested edit dialogs must not close the lookup.
          if (event.target === event.currentTarget) reset();
        }}
      >
        <header className="ticket-lookup-dialog-heading">
          <h2 id={titleId} className="ticket-lookup-breadcrumbs">
            {history.map((view, index) => (
              <Fragment key={view.key}>
                <button
                  type="button"
                  onClick={() => goBack(index)}
                  title={`Вернуться к тикету #${view.id}`}
                >
                  Тикет #{view.id}
                </button>
                <ChevronRight size={16} aria-hidden="true" />
              </Fragment>
            ))}
            <span aria-current={history.length ? "page" : undefined}>
              {selection.length > 1
                ? `Тикеты · ${selection.length}`
                : cardRef || selection.length
                  ? `Тикет #${id}`
                  : "Открыть тикет по номеру"}
            </span>
          </h2>
          {history.length > 0 && (
            <button type="button" className="secondary ticket-lookup-back" onClick={() => goBack()}>
              <ArrowLeft size={16} aria-hidden="true" /> Назад
            </button>
          )}
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            aria-label={
              cardRef && !selection.length && !history.length
                ? "Закрыть деталку и вернуться к вводу номера"
                : "Закрыть поиск тикета"
            }
            title={
              cardRef && !selection.length && !history.length
                ? "Вернуться к вводу номера"
                : "Закрыть"
            }
            onClick={() => {
              if (history.length) {
                reset();
                dialog.current?.close();
              } else backOrClose();
            }}
          >
            <X size={20} />
          </button>
        </header>
        {open &&
          [
            ...history,
            { key: viewKey, id, source: source.current, selection, citation, cardRef },
          ].map((view) => {
            const { selection, id, cardRef, citation } = view;
            const active = view.key === viewKey;
            return (
              <div key={view.key} className="ticket-lookup-frame" hidden={!active}>
                {selection.length ? (
                  <div
                    className={`ticket-viewer-layout${selection.length === 1 ? " is-single" : ""}`}
                  >
                    {selection.length > 1 && (
                      <nav className="ticket-viewer-list" aria-label="Выбранные тикеты">
                        {selection.map((ticket) => (
                          <button
                            type="button"
                            key={ticket.id}
                            aria-current={String(ticket.id) === id ? "true" : undefined}
                            onClick={() => void selectTicket(ticket.id)}
                          >
                            <Ticket size={16} aria-hidden="true" />
                            <span>
                              <b>#{ticket.id}</b>
                              <span>{ticket.title}</span>
                              <span className="ticket-viewer-badges">
                                {ticket.type && (
                                  <StatusBadge
                                    kind="type"
                                    state={ticket.type}
                                    colors={typeColors}
                                  />
                                )}
                                {ticket.state && (
                                  <StatusBadge state={ticket.state} colors={statusColors} />
                                )}
                              </span>
                            </span>
                          </button>
                        ))}
                      </nav>
                    )}
                    <div className="ticket-viewer-content" aria-busy={busy}>
                      {active && busy ? (
                        <p role="status">Загружаю тикет…</p>
                      ) : active && error ? (
                        <div role="alert">
                          <p>{error}</p>
                          <button
                            className="secondary"
                            onClick={() => void selectTicket(Number(id))}
                          >
                            Повторить
                          </button>
                        </div>
                      ) : cardRef ? (
                        <TicketCard key={cardRef} reference={cardRef} citation={citation} />
                      ) : null}
                    </div>
                  </div>
                ) : cardRef ? (
                  <TicketCard reference={cardRef} citation={citation} />
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
                          const result = await api(`/tickets/${encodeURIComponent(id)}/details`);
                          if (current === request.current) {
                            source.current = result.source;
                            setCardRef(result.cardId);
                          }
                        } catch (e: any) {
                          if (current === request.current) setError(e.message);
                        } finally {
                          if (current === request.current) setBusy(false);
                        }
                      }}
                    >
                      <label>
                        Номер тикета
                        <NumberInput
                          ref={input}
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
                )}
              </div>
            );
          })}
      </dialog>
    </>
  );
}
