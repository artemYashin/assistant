import type { Store } from "./store.js";
export const prLinksKey = (monitor: string, repo: string, number: number) =>
  "pr.azureLinks:" + JSON.stringify([monitor, repo, number]);
export function cachedPrLinks(
  store: Store,
  monitor: string,
  repo: string,
  number: number,
) {
  return store.get<{ ids: number[]; error: string }>(
    prLinksKey(monitor, repo, number),
    { ids: [], error: "Связи Azure ещё не загружены. Синхронизируйте PR." },
  );
}
