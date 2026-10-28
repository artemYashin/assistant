import type { Filters } from "../../../features/filter-tickets/index.js";

export function matchesTicketFilters(
  t: any,
  filters: Filters,
  localManagement: boolean,
  azureMode = false,
) {
  const {
    query,
    overdueDeadline,
    azurePriorityFilter,
    priorityFilter,
    tagFilter,
    azureTagFilter,
    typeFilter,
    stateFilter,
    assigneeFilter,
    localFilter,
  } = filters;
  const matchesQuery = azureMode
    ? /^#?\d+$/.test(query.trim())
      ? t.id === Number(query.trim().replace("#", ""))
      : [t.title, ...(t.azureTags || [])].some((value) =>
          String(value || "")
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
    : [
        "id",
        "title",
        "type",
        "state",
        "assigned",
        ...(localManagement ? ["developer_name"] : []),
        "notes",
        "tags",
        "azureTags",
      ].some((key) =>
        String(t[key] || "")
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      );
  return (
    matchesQuery &&
    (!overdueDeadline || (t.localDeadline && Date.parse(t.localDeadline) < Date.now())) &&
    (!azurePriorityFilter.length ||
      azurePriorityFilter.includes(t.azurePriority == null ? "" : String(t.azurePriority))) &&
    (!priorityFilter.length || priorityFilter.includes(String(t.priority ?? 1))) &&
    (!tagFilter.length ||
      tagFilter.some((tag) => (tag === "" ? !t.tags?.length : t.tags?.includes(tag)))) &&
    (!azureTagFilter.length ||
      azureTagFilter.some((tag) =>
        tag === "" ? !t.azureTags?.length : t.azureTags?.includes(tag),
      )) &&
    (!typeFilter.length || typeFilter.includes(t.type || "")) &&
    (!stateFilter.length || stateFilter.includes(t.state || "")) &&
    (!assigneeFilter.length || assigneeFilter.includes(t.assigned || "")) &&
    (!localFilter.length ||
      localFilter.some((id) =>
        id === "" ? !t.developers?.length : t.developers?.some((d: any) => d.id === id),
      ))
  );
}
