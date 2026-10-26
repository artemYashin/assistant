import type { Store } from "./store.js";
export const prLinksKey = (monitor: string, repo: string, number: number) =>
  "pr.azureLinks:" + JSON.stringify([monitor, repo, number]);
export function cachedPrLinks(store: Store, monitor: string, repo: string, number: number) {
  return store.get<{ ids: number[]; error: string }>(prLinksKey(monitor, repo, number), {
    ids: [],
    error: "Связи Azure ещё не загружены. Синхронизируйте PR.",
  });
}

export function excludedPrTicketIds(
  store: Store,
  monitor: string,
  repo: string,
  number: number,
): number[] {
  return (
    store.db
      .prepare("SELECT ticket_id FROM pr_ticket_exclusions WHERE monitor=? AND repo=? AND number=?")
      .all(monitor, repo, number) as { ticket_id: number }[]
  ).map((row) => row.ticket_id);
}
