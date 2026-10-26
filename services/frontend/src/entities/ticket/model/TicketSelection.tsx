import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type SelectableTicket = { id: number; source: string; title?: string };
export const ticketKey = (ticket: SelectableTicket) => JSON.stringify([ticket.source, ticket.id]);

let chatTickets: SelectableTicket[] = [];
const listeners = new Set<() => void>();
function publishTickets(tickets: SelectableTicket[]) {
  chatTickets = tickets;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useSelectedChatTickets() {
  return useSyncExternalStore(subscribe, () => chatTickets);
}

export function useTicketSelection<T extends SelectableTicket>(tickets: T[], context: string) {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const visibleKey = JSON.stringify(tickets.map(ticketKey).sort());
  useEffect(() => {
    const visible = new Set<string>(JSON.parse(visibleKey));
    setKeys((old) => new Set([...old].filter((key) => visible.has(key))));
  }, [visibleKey]);
  useEffect(() => setKeys(new Set()), [context]);
  const selected = tickets.filter((ticket) => keys.has(ticketKey(ticket)));
  const selectionJson = JSON.stringify(
    selected.map(({ id, source, title }) => ({ id, source, title })),
  );
  useEffect(() => {
    publishTickets(JSON.parse(selectionJson));
  }, [selectionJson]);
  useEffect(() => () => publishTickets([]), []);
  return {
    selected,
    checked: (ticket: T) => keys.has(ticketKey(ticket)),
    toggle: (ticket: T) =>
      setKeys((old) => {
        const next = new Set(old);
        const key = ticketKey(ticket);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    clear: () => setKeys(new Set()),
    toggleAll: () =>
      setKeys(selected.length === tickets.length ? new Set() : new Set(tickets.map(ticketKey))),
  };
}

export function SelectAllTickets({
  count,
  total,
  onChange,
}: {
  count: number;
  total: number;
  onChange: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = count > 0 && count < total;
  }, [count, total]);
  return (
    <input
      ref={input}
      className="ticket-checkbox"
      type="checkbox"
      aria-label="Выбрать все показанные тикеты"
      checked={total > 0 && count === total}
      disabled={!total}
      onChange={onChange}
    />
  );
}
