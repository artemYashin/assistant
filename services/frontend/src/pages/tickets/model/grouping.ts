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
  // Only children of retained, visible groups leave the root list. This keeps
  // grandchildren reachable in a one-level view and avoids empty cyclic groups.
  const identity = (source: string, id: number) => JSON.stringify([source, id]);
  const candidates = enabled
    ? roots.filter((ticket) => types.includes(ticket.type) && parents[ticket.id]?.childIds.length)
    : [];
  const remaining = new Map(
    candidates.map((ticket) => [identity(ticket.source, ticket.id), ticket]),
  );
  const outgoing = new Map(
    candidates.map((ticket) => [
      identity(ticket.source, ticket.id),
      parents[ticket.id].childIds
        .filter((id) => id !== ticket.id)
        .map((id) => identity(ticket.source, id)),
    ]),
  );
  const incoming = new Map<string, number>();
  for (const children of outgoing.values())
    for (const key of children) incoming.set(key, (incoming.get(key) || 0) + 1);
  const order = [...remaining.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const queue = order.filter((key) => !incoming.get(key));
  const hidden = new Set<string>();
  const retained = new Set<string>();
  const remove = (key: string) => {
    if (!remaining.delete(key)) return;
    for (const child of outgoing.get(key) || []) {
      const count = (incoming.get(child) || 0) - 1;
      incoming.set(child, count);
      if (count === 0 && remaining.has(child)) queue.push(child);
    }
  };
  while (remaining.size) {
    // A deterministic representative breaks a cycle without hiding every ticket.
    const key = queue.shift() || order.find((candidate) => remaining.has(candidate))!;
    if (!remaining.has(key)) continue;
    retained.add(key);
    remove(key);
    for (const child of outgoing.get(key) || []) {
      if (retained.has(child)) continue;
      hidden.add(child);
      remove(child);
    }
  }
  return roots
    .filter((ticket) => !hidden.has(identity(ticket.source, ticket.id)))
    .flatMap((ticket) => {
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
