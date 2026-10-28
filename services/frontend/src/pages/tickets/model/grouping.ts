export type GroupPreferences = { mode: "list" | "grouped"; parentTypes: string[] };
export function parseGroupPreferences(value: string | null): GroupPreferences {
  try {
    const parsed = JSON.parse(value || "null");
    return {
      mode: parsed?.mode === "grouped" ? "grouped" : "list",
      parentTypes: Array.isArray(parsed?.parentTypes)
        ? [
            ...new Set<string>(
              parsed.parentTypes.filter((v: unknown) => typeof v === "string" && v.trim()),
            ),
          ]
        : [],
    };
  } catch {
    return { mode: "list", parentTypes: [] };
  }
}
export type ParentChildren = { id: number; childIds: number[]; children?: any[] };
export type GroupRow = {
  key: string;
  ticket: any;
  child: boolean;
  expandable: boolean;
  expanded: boolean;
};
export function groupedTicketRows(
  roots: any[],
  enabled: boolean,
  types: string[],
  parents: Record<number, ParentChildren>,
  expanded: Set<number>,
): GroupRow[] {
  return roots.flatMap((ticket) => {
    const parent = parents[ticket.id];
    const expandable = enabled && types.includes(ticket.type) && !!parent?.childIds.length;
    const open = expandable && expanded.has(ticket.id);
    const key = JSON.stringify([ticket.source, ticket.id]);
    const root: GroupRow = { key, ticket, child: false, expandable, expanded: open };
    return [
      root,
      ...(open
        ? (parent.children || []).map((child) => ({
            key: JSON.stringify([ticket.source, ticket.id, child.source, child.id]),
            ticket: child,
            child: true,
            expandable: false,
            expanded: false,
          }))
        : []),
    ];
  });
}
export function uniqueGroupTickets(rows: GroupRow[]) {
  return [
    ...new Map(
      rows
        .filter((row) => !row.ticket.unavailable)
        .map(({ ticket }) => [JSON.stringify([ticket.source, ticket.id]), ticket]),
    ).values(),
  ];
}
