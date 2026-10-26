export type PrFilters = { draft: string; review: string; sort: string };
export function filterPullRequests<
  T extends {
    draft?: number | boolean;
    review_status?: string;
    created_at?: string;
    number: number;
    title?: string;
    monitor?: string;
    repo?: string;
  },
>(items: T[], filters: PrFilters): T[] {
  const [key, direction] = filters.sort.split(":");
  const factor = direction === "asc" ? 1 : -1;
  return items
    .filter(
      (p) =>
        (filters.draft === "all" || !!p.draft === (filters.draft === "draft")) &&
        (filters.review === "all" ||
          (p.review_status === "completed") === (filters.review === "ready")),
    )
    .sort((a, b) => {
      let compare = 0;
      if (key === "created") {
        const aTime = Date.parse(a.created_at || ""),
          bTime = Date.parse(b.created_at || "");
        if (Number.isFinite(aTime) !== Number.isFinite(bTime))
          return Number.isFinite(aTime) ? -1 : 1;
        if (Number.isFinite(aTime)) compare = aTime - bTime;
      } else if (key === "number") compare = a.number - b.number;
      else
        compare = (a.title || "").localeCompare(b.title || "", "ru", {
          numeric: true,
        });
      return (
        compare * factor ||
        b.number - a.number ||
        `${a.monitor}:${a.repo}`.localeCompare(`${b.monitor}:${b.repo}`)
      );
    });
}
