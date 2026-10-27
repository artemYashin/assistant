export type TicketView = "table" | "kanban";
export const TICKET_VIEW_KEY = "orbit.tickets.view";
export function parseTicketView(value: string | null): TicketView {
  return value === "kanban" ? "kanban" : "table";
}
export type KanbanTicket = {
  id: number;
  source: string;
  title?: string;
  state?: string;
  type?: string;
  assigned?: string;
  localDeadline?: string | null;
};
export function ticketStateColumns(
  tickets: KanbanTicket[],
  states: string[],
  order: string[] = [],
  selected: string[] = [],
  hidden: string[] = [],
  filterColumnsByStatus = false,
  hideEmptyColumns = false,
) {
  const rank = new Map(order.map((state, index) => [state, index]));
  return [...new Set([...states, ...tickets.map((ticket) => ticket.state || ""), ...selected])]
    .filter(
      (state) =>
        !hidden.includes(state) &&
        (!filterColumnsByStatus || !selected.length || selected.includes(state)),
    )
    .sort((a, b) => {
      const left = rank.get(a) ?? order.length;
      const right = rank.get(b) ?? order.length;
      return left - right || a.localeCompare(b, "ru");
    })
    .map((state) => ({
      state,
      tickets: tickets.filter((ticket) => (ticket.state || "") === state),
    }))
    .filter((column) => !hideEmptyColumns || column.tickets.length > 0);
}
