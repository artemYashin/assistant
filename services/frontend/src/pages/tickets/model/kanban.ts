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
  imported?: boolean;
  inTrash?: boolean;
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

export type KanbanGroup = {
  id: string;
  name: string;
  states: string[];
  color?: string | null;
  defaultState: string;
};
export function groupedTicketColumns(
  tickets: KanbanTicket[],
  states: string[],
  order: string[] = [],
  selected: string[] = [],
  hidden: string[] = [],
  filterColumnsByStatus = false,
  hideEmptyColumns = false,
  groups: KanbanGroup[] = [],
) {
  const members = new Map(
    groups.flatMap((group) => group.states.map((state) => [state, group] as const)),
  );
  const individual = ticketStateColumns(
    tickets,
    [...states, ...groups.flatMap((g) => g.states)],
    order,
    selected,
    hidden,
    filterColumnsByStatus,
  );
  const result = new Map<
    string,
    {
      state: string;
      name: string;
      states: string[];
      color?: string | null;
      defaultState: string;
      tickets: KanbanTicket[];
    }
  >();
  for (const column of individual) {
    const group = members.get(column.state);
    const id = group?.id ?? column.state;
    let target = result.get(id);
    if (!target) {
      target = {
        state: id,
        name: group?.name ?? column.state,
        color: group?.color,
        states: [],
        defaultState: group?.defaultState ?? column.state,
        tickets: [],
      };
      result.set(id, target);
    }
    target.states.push(column.state);
  }
  // Preserve the selected ticket sort across states inside a group.
  for (const column of result.values()) {
    column.tickets = tickets.filter((ticket) => column.states.includes(ticket.state || ""));
    if (!column.states.includes(column.defaultState)) column.defaultState = column.states[0];
  }
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index < 0 ? order.length : index;
  };
  return [...result.values()]
    .sort((a, b) => rank(a.state) - rank(b.state) || a.name.localeCompare(b.name, "ru"))
    .filter((column) => !hideEmptyColumns || column.tickets.length);
}
