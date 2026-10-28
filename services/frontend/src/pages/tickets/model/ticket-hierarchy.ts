export type HierarchyTicket = {
  id: number;
  source: string;
  imported?: boolean;
  inTrash?: boolean;
  relations?: { id: number; rel: string }[] | null;
  relationsUpdatedAt?: string | null;
};
export const hierarchyKey = (ticket: { source: string; id: number }) =>
  JSON.stringify([ticket.source, ticket.id]);

/** Preserve the input sort order within each sibling group; never add filtered-out rows. */
export function ticketHierarchy<T extends HierarchyTicket>(tickets: T[], expanded: Set<string>) {
  const byKey = new Map(tickets.map((ticket) => [hierarchyKey(ticket), ticket]));
  const parents = new Map<string, string>();
  const imported = (ticket: HierarchyTicket) =>
    ticket.imported !== false || ticket.inTrash === true;
  for (const ticket of tickets) {
    if (!imported(ticket)) continue;
    const key = hierarchyKey(ticket);
    const parent = ticket.relations?.find(
      (link) => link.rel === "System.LinkTypes.Hierarchy-Reverse",
    );
    if (parent) {
      const parentKey = hierarchyKey({ source: ticket.source, id: parent.id });
      const parentTicket = byKey.get(parentKey);
      if (parentKey !== key && parentTicket && imported(parentTicket)) parents.set(key, parentKey);
    }
  }
  // A parent's links can help when the child has never been cached. A known
  // child snapshot (including an empty one) takes precedence over older parent links.
  for (const ticket of tickets) {
    if (!imported(ticket)) continue;
    for (const link of ticket.relations || []) {
      if (link.rel !== "System.LinkTypes.Hierarchy-Forward") continue;
      const key = hierarchyKey({ source: ticket.source, id: link.id });
      const child = byKey.get(key);
      if (
        child &&
        imported(child) &&
        child !== ticket &&
        child.relations == null &&
        !parents.has(key)
      )
        parents.set(key, hierarchyKey(ticket));
    }
  }
  // Corrupt/cyclic links must not hide tickets or recurse forever.
  const checked = new Set<string>();
  for (const key of byKey.keys()) {
    const path = new Set<string>();
    let cursor: string | undefined = key;
    while (cursor && !checked.has(cursor)) {
      if (path.has(cursor)) {
        parents.delete(cursor);
        break;
      }
      path.add(cursor);
      cursor = parents.get(cursor);
    }
    for (const value of path) checked.add(value);
  }
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const ticket of byKey.values()) {
    const parent = parents.get(hierarchyKey(ticket));
    if (!parent) roots.push(ticket);
    else {
      const siblings = children.get(parent) || [];
      siblings.push(ticket);
      children.set(parent, siblings);
    }
  }
  const rows: { ticket: T; depth: number; children: number; expanded: boolean }[] = [];
  const stack = roots.map((ticket) => ({ ticket, depth: 0 })).reverse();
  while (stack.length) {
    const row = stack.pop()!;
    const key = hierarchyKey(row.ticket);
    const nested = children.get(key) || [];
    rows.push({ ...row, children: nested.length, expanded: expanded.has(key) });
    if (expanded.has(key))
      for (let i = nested.length - 1; i >= 0; i--)
        stack.push({ ticket: nested[i], depth: row.depth + 1 });
  }
  return { rows, parents };
}
