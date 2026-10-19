import { useEffect, useRef, useState } from "react";

export type SelectableTicket = { id: number; source: string; title?: string };
export const ticketKey = (ticket: SelectableTicket) =>
  JSON.stringify([ticket.source, ticket.id]);

export function useTicketSelection<T extends SelectableTicket>(
  tickets: T[],
  context: string,
) {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const visibleKey = JSON.stringify(tickets.map(ticketKey).sort());
  useEffect(() => {
    const visible = new Set<string>(JSON.parse(visibleKey));
    setKeys((old) => new Set([...old].filter((key) => visible.has(key))));
  }, [visibleKey]);
  useEffect(() => setKeys(new Set()), [context]);
  const selected = tickets.filter((ticket) => keys.has(ticketKey(ticket)));
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
      setKeys(
        selected.length === tickets.length
          ? new Set()
          : new Set(tickets.map(ticketKey)),
      ),
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
