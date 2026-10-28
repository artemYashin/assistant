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

/** Rows are paths, while selection/export use unique tickets. Inputs are already filtered. */
export function ticketHierarchy<T extends HierarchyTicket>(
  tickets: T[],
  expanded: Set<string>,
  trash: T[] = [],
) {
  const resultKeys = new Set(tickets.map(hierarchyKey));
  const byKey = new Map(tickets.map((ticket) => [hierarchyKey(ticket), ticket]));
  for (const ticket of trash)
    if (ticket.inTrash && !byKey.has(hierarchyKey(ticket))) byKey.set(hierarchyKey(ticket), ticket);
  const edges = new Map<string, Set<string>>();
  const imported = (ticket: HierarchyTicket) =>
    ticket.imported !== false || ticket.inTrash === true;
  const link = (parent: string, child: string) => {
    if (parent === child || !byKey.has(parent) || !byKey.has(child)) return;
    if (!imported(byKey.get(parent)!) || !imported(byKey.get(child)!)) return;
    if (!edges.has(parent)) edges.set(parent, new Set());
    edges.get(parent)!.add(child);
  };
  for (const [key, ticket] of byKey)
    for (const relation of ticket.relations || []) {
      const other = hierarchyKey({ source: ticket.source, id: relation.id });
      if (relation.rel === "System.LinkTypes.Hierarchy-Reverse") link(other, key);
      if (relation.rel === "System.LinkTypes.Hierarchy-Forward") link(key, other);
    }
  // Extra trash rows are descendants only: never promote a missing parent from trash.
  const included = new Set(resultKeys);
  const pending = [...resultKeys];
  while (pending.length)
    for (const child of edges.get(pending.pop()!) || [])
      if (!included.has(child)) {
        included.add(child);
        pending.push(child);
      }

  // Remove only DFS back-edges, preserving multiple parents in the acyclic graph.
  const state = new Map<string, number>();
  const children = new Map<string, string[]>();
  const order = new Map([...byKey.keys()].map((key, index) => [key, index]));
  for (const root of included) {
    if (state.has(root)) continue;
    const stack = [
      {
        key: root,
        next: 0,
        edges: [...(edges.get(root) || [])].filter((key) => included.has(key)),
      },
    ];
    state.set(root, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.next === frame.edges.length) {
        state.set(frame.key, 2);
        stack.pop();
        continue;
      }
      const child = frame.edges[frame.next++];
      if (state.get(child) === 1) continue;
      if (!children.has(frame.key)) children.set(frame.key, []);
      children.get(frame.key)!.push(child);
      if (!state.has(child)) {
        state.set(child, 1);
        stack.push({
          key: child,
          next: 0,
          edges: [...(edges.get(child) || [])].filter((key) => included.has(key)),
        });
      }
    }
  }
  const parents = new Map<string, Set<string>>();
  for (const [parent, nested] of children) {
    nested.sort((a, b) => order.get(a)! - order.get(b)!);
    for (const child of nested) {
      if (!parents.has(child)) parents.set(child, new Set());
      parents.get(child)!.add(parent);
    }
  }
  const unique = [...byKey.entries()].filter(([key]) => included.has(key));
  const roots = unique.filter(([key]) => !parents.has(key));
  const rows: { key: string; ticket: T; depth: number; children: number; expanded: boolean }[] = [];
  const stack = roots.map(([key]) => ({ id: key, path: [key], depth: 0 })).reverse();
  while (stack.length) {
    const row = stack.pop()!;
    const nested = children.get(row.id) || [];
    rows.push({
      key: JSON.stringify(row.path),
      ticket: byKey.get(row.id)!,
      depth: row.depth,
      children: nested.length,
      expanded: expanded.has(row.id),
    });
    if (expanded.has(row.id))
      for (let i = nested.length - 1; i >= 0; i--)
        stack.push({ id: nested[i], path: [...row.path, nested[i]], depth: row.depth + 1 });
  }
  return { rows, parents, tickets: unique.map(([, ticket]) => ticket) };
}
