import { useEffect, useState } from "react";

type ViewedTicket = { id: number; source: string };

/** Same snapshot is used for the badge and the outgoing chat request. */
export function currentViewedTicket(): ViewedTicket | undefined {
  const cards = [...document.querySelectorAll<HTMLElement>("dialog[open] .ticket-detail[data-viewed-ticket-id]")];
  const card = cards.reverse().find(element => !element.closest("dialog:not([open])") && element.getClientRects().length > 0);
  const id = Number(card?.dataset.viewedTicketId), source = card?.dataset.viewedTicketSource;
  return Number.isSafeInteger(id) && id > 0 && source ? { id, source } : undefined;
}

export function useViewedTicket() {
  const [ticket, setTicket] = useState<ViewedTicket>();
  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      frame = 0;
      const next = currentViewedTicket();
      setTicket(previous => previous?.id === next?.id && previous?.source === next?.source ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["open", "data-viewed-ticket-id", "data-viewed-ticket-source"],
    });
    window.addEventListener("resize", schedule);
    refresh();
    return () => { observer.disconnect(); window.removeEventListener("resize", schedule); cancelAnimationFrame(frame); };
  }, []);
  return ticket;
}
