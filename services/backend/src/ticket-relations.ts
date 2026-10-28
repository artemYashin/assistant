export type TicketRelation = { id: number; rel: string };

/** Only work-item links in this collection; never follow URLs supplied by a link. */
export function parseTicketRelations(value: unknown, base: string): TicketRelation[] | null {
  if (!Array.isArray(value)) return null;
  const links = new Map<string, TicketRelation>();
  for (const link of value) {
    if (typeof link?.rel !== "string" || !link.rel.startsWith("System.LinkTypes.")) continue;
    if (typeof link.url !== "string" || !link.url.startsWith(base.replace(/\/$/, "") + "/"))
      continue;
    const match = /\/_apis\/wit\/workitems\/([1-9]\d*)$/i.exec(link.url);
    const id = Number(match?.[1]);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    links.set(`${link.rel}:${id}`, { id, rel: link.rel });
  }
  return [...links.values()];
}
