import { hasLocalManagement } from "../../../../../backend/src/work-mode.js";
import { NumberInput } from "../../../shared/ui/number-input/index.js";
import { TicketColorLegend } from "../../../entities/ticket/index.js";
import { paginationItems } from "../../../shared/lib/pagination/index.js";
import { TicketDataRow } from "../../../widgets/ticket/index.js";
import { useAzureTicketBrowser } from "../../../features/filter-tickets/index.js";
import { ImportAzureTickets } from "../../../features/import-tickets/index.js";
import { useTicketFilterOptions } from "../../../features/filter-tickets/index.js";
import { TicketFilterPanel } from "../../../features/filter-tickets/index.js";
import { useTicketFilters } from "../../../features/filter-tickets/index.js";
import { RotateCcw } from "lucide-react";
import { OrderedTicketCells, useTicketColumns } from "../../../features/ticket-columns/index.js";
import { BulkTicketStatus } from "../../../features/edit-ticket/index.js";
import { SelectAllTickets, useTicketSelection } from "../../../entities/ticket/index.js";
import { ExportTickets } from "../../../features/export-tickets/ui/index.js";
import { LastSync } from "../../../shared/ui/last-sync/index.js";
import { MultiSelect } from "../../../shared/ui/multi-select/index.js";
import { AzureAssigneeFilter } from "../../../features/filter-tickets/index.js";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpDown, ArrowUp, Plus, RefreshCw, Search, Ticket } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { Empty } from "../../../shared/ui/empty/index.js";
import { PageHeading } from "../../../shared/ui/page-heading/index.js";

export function Tickets({
  tickets: localTickets,
  lastSync,
  run: parentRun,
  busy,
  settings,
  context,
  azureMode = false,
}: any) {
  const currentSource = `${(settings?.azureUrl || "").replace(/\/$/, "")}|${settings?.azureProject || ""}`;
  const browser = useAzureTicketBrowser(
    azureMode,
    currentSource,
    JSON.stringify([currentSource, context.client, context.project]),
  );
  const { refresh: refreshAzure, search: searchAzure } = browser;
  useEffect(() => {
    if (!azureMode) return;
    const refresh = () => refreshAzure();
    const events = [
      "orbit:ticket-state",
      "orbit:ticket-assignee",
      "orbit:ticket-metadata",
      "orbit:ticket-developers",
      "orbit:ticket-tracked",
      "orbit:ticket-removed",
    ];
    events.forEach((name) => window.addEventListener(name, refresh));
    return () => events.forEach((name) => window.removeEventListener(name, refresh));
  }, [azureMode, refreshAzure]);
  const run = async (...args: any[]) => {
    await parentRun(...args);
    if (azureMode) browser.refresh();
  };
  const tickets = azureMode
    ? browser.rows.map((t: any) => {
        const local = localTickets.find(
          (item: any) => item.source === t.source && item.id === t.id,
        );
        return local
          ? {
              ...t,
              ...local,
              title: t.title,
              state: t.state,
              type: t.type,
              assigned: t.assigned,
              azurePriority: t.azurePriority,
              azureTags: t.azureTags,
              created_at: t.created_at,
              changed_at: t.changed_at,
              imported: true,
              inTrash: false,
            }
          : { ...t, imported: false };
      })
    : localTickets;
  const filterTickets = azureMode ? [...localTickets, ...tickets] : tickets;
  const columns = useTicketColumns(false, azureMode ? "azure" : "active");
  const localFilterOptions = useTicketFilterOptions(context, settings, localTickets);
  const filterOptions = azureMode
    ? { ...localFilterOptions, ...browser.catalog }
    : localFilterOptions;
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const rawTarget = azureMode ? null : params.get("id");
  const targetId =
    rawTarget && /^[1-9][0-9]*$/.test(rawTarget) && Number.isSafeInteger(Number(rawTarget))
      ? Number(rawTarget)
      : null;
  const targetSource = params.get("source");

  const sourceMismatch = !!targetSource && !!settings && targetSource !== currentSource;
  const [id, setId] = useState(targetId ? String(targetId) : "");
  const filterStorageKey =
    `orbit.ticket-filters.${azureMode ? "azure" : "active"}:` +
    JSON.stringify([currentSource, context.client, context.project]);
  const {
    filters,
    rawFilters,
    set: setFilter,
    apply: applyFilters,
  } = useTicketFilters(filterStorageKey);
  const {
    query,
    sort,
    azurePriorityFilter,
    overdueDeadline,
    priorityFilter,
    tagFilter,
    azureTagFilter,
    typeFilter,
    stateFilter,
    assigneeFilter,
    localFilter,
  } = filters;
  const previousSort = useRef(sort);
  useEffect(() => {
    if (previousSort.current === sort) return;
    previousSort.current = sort;
    if (azureMode) void searchAzure(filters);
  }, [sort, azureMode, filters, searchAzure]);
  const setQuery = (value: string) => setFilter("query", value);
  const setSort = (value: string) => setFilter("sort", value);
  const setAzurePriorities = (value: string[]) => setFilter("azurePriorityFilter", value);
  const setPriorityFilter = (value: string[]) => setFilter("priorityFilter", value);
  const setTagFilter = (value: string[]) => setFilter("tagFilter", value);
  const setAzureTagFilter = (value: string[]) => setFilter("azureTagFilter", value);
  const setTypeFilter = (value: string[]) => setFilter("typeFilter", value);
  const setStateFilter = (value: string[]) => setFilter("stateFilter", value);
  const setAssigneeFilter = (value: string[]) => setFilter("assigneeFilter", value);
  const setLocalFilter = (value: string[]) => setFilter("localFilter", value);
  const values = (key: string) =>
    [...new Set<string>(filterTickets.map((t: any) => t[key] || ""))].sort((a, b) =>
      a.localeCompare(b, "ru"),
    );
  const localDevelopers = [
    ...new Map<string, string>(
      filterTickets.flatMap((t: any) => (t.developers || []).map((d: any) => [d.id, d.name])),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  const filteredTickets = tickets.filter((t: any) => {
    if (azureMode) return true;
    if (rawTarget) return !sourceMismatch && t.id === targetId;
    const matchesQuery = [
      "id",
      "title",
      "type",
      "state",
      "assigned",
      ...(hasLocalManagement(settings) ? ["developer_name"] : []),
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
  });
  const [sortKey, sortDirection] = sort.split("-");
  const sortButton = (key: string, label: string) => (
    <button
      type="button"
      className={`ticket-column-sort${sortKey === key ? " is-active" : ""}`}
      aria-label={`Сортировать: ${label}, ${sortKey === key && sortDirection === "asc" ? "по убыванию" : "по возрастанию"}`}
      onClick={() =>
        setSort(`${key}-${sortKey === key && sortDirection === "asc" ? "desc" : "asc"}`)
      }
    >
      <span>{label}</span>
      {sortKey === key ? (
        sortDirection === "asc" ? (
          <ArrowUp size={13} />
        ) : (
          <ArrowDown size={13} />
        )
      ) : (
        <ArrowUpDown size={13} />
      )}
    </button>
  );
  const columnSort = (keys: string[]): "ascending" | "descending" | "none" =>
    keys.includes(sortKey) ? (sortDirection === "asc" ? "ascending" : "descending") : "none";
  const sorted = azureMode
    ? filteredTickets
    : [...filteredTickets].sort((a, b) => {
        const [key, direction] = sort.split("-");
        if (key === "azurePriority") {
          if (a[key] == null || b[key] == null)
            return a[key] == null ? (b[key] == null ? a.id - b.id : 1) : -1;
          return (direction === "desc" ? b[key] - a[key] : a[key] - b[key]) || a.id - b.id;
        }
        const cmp =
          key === "id"
            ? a.id - b.id
            : ["created_at", "changed_at"].includes(key)
              ? (Date.parse(a[key]) || 0) - (Date.parse(b[key]) || 0)
              : String(a[key] || "").localeCompare(String(b[key] || ""), "ru", {
                  numeric: true,
                });
        return (direction === "desc" ? -cmp : cmp) || a.id - b.id;
      });
  const selection = useTicketSelection<any>(sorted, JSON.stringify([currentSource, context]));
  return (
    <>
      <div className="ticket-page-intro">
        <PageHeading
          title={azureMode ? "Azure тикеты" : "Ваши тикеты"}
          subtitle={
            azureMode
              ? `${settings?.azureProject || "Проект не настроен"} · поиск по кнопке или Enter, по 50 задач на страницу.`
              : "Актуальный статус из Azure DevOps. Данные обновляются в фоне."
          }
        />
        {!azureMode && <LastSync at={lastSync} />}
      </div>
      {rawTarget && (
        <div className="ticket-target-notice" role="status">
          <p>
            {!targetId
              ? "Некорректный номер тикета в ссылке."
              : sourceMismatch
                ? "Этот тикет относится к другому подключению Azure. Выберите соответствующее подключение в настройках."
                : `Показан тикет #${targetId} из ссылки. Если его ещё нет в локальном списке, добавьте по номеру ниже.`}
          </p>
          <Link to="/tickets">Показать все тикеты</Link>
        </div>
      )}
      <div className="ticket-management-toolbar">
        <form
          className="ticket-search-block"
          onSubmit={(event) => {
            event.preventDefault();
            if (azureMode) void searchAzure(filters);
          }}
        >
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Поиск тикетов"
              maxLength={azureMode ? 200 : undefined}
              placeholder={
                azureMode ? "Номер, название или Azure тег…" : "Номер, название, исполнитель…"
              }
              disabled={!!rawTarget}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {azureMode && (
            <button type="submit" className="primary" disabled={browser.loading}>
              <Search size={16} />
              {browser.loading ? "Поиск…" : "Найти"}
            </button>
          )}
        </form>
        {!azureMode && (
          <div className="ticket-add-block">
            <form
              className="ticket-add-form"
              onSubmit={(e) => {
                e.preventDefault();
                run("track", () => api("/tickets", "POST", { id: Number(id) }), "Тикет добавлен");
              }}
            >
              <NumberInput
                aria-label="Номер тикета для добавления"
                min="1"
                required
                placeholder="Номер тикета"
                value={id}
                onChange={(e) => setId(e.target.value)}
              />
              <button className="primary" disabled={!!busy || sourceMismatch}>
                <Plus size={16} />
                Добавить по номеру
              </button>
            </form>
            <button
              type="button"
              className="secondary"
              disabled={!!busy}
              onClick={() =>
                run(
                  "import",
                  () => api("/tickets/import", "POST", {}),
                  "Синхронизация тикетов завершена",
                )
              }
            >
              <RefreshCw size={15} />
              Синхронизировать тикеты
            </button>
          </div>
        )}
      </div>
      <TicketFilterPanel
        storageKey={filterStorageKey}
        filters={rawFilters}
        onApply={applyFilters}
        disabled={!!rawTarget}
      >
        {filterOptions.error && (
          <p className="error" role="alert">
            Не удалось загрузить справочник фильтров: {filterOptions.error}
          </p>
        )}
        <div className="ticket-filters">
          <button
            className="secondary ticket-filter-reset"
            title="Сбросить все фильтры и поиск"
            onClick={() => {
              if (rawTarget) navigate("/tickets");
              setPriorityFilter([]);
              setAzurePriorities([]);
              setFilter("overdueDeadline", false);
              setTagFilter([]);
              setAzureTagFilter([]);
              setTypeFilter([]);
              setStateFilter([]);
              setAssigneeFilter([]);
              if (hasLocalManagement(settings)) setLocalFilter([]);
              setQuery("");
            }}
          >
            <RotateCcw size={15} /> Сбросить
          </button>
          <MultiSelect
            label="Просрочен дедлайн"
            placeholder="Любой дедлайн"
            disabled={!!rawTarget}
            value={overdueDeadline ? ["overdue"] : []}
            onChange={(values) => setFilter("overdueDeadline", values.includes("overdue"))}
            options={[{ value: "overdue", label: "Просрочен дедлайн" }]}
          />
          <MultiSelect
            label="Azure приоритет"
            placeholder="Все Azure приоритеты"
            value={azurePriorityFilter}
            onChange={setAzurePriorities}
            options={[
              { value: "", label: "Без Azure приоритета" },
              ...filterOptions.azurePriorities.map((v) => ({ value: String(v), label: String(v) })),
            ]}
          />
          <MultiSelect
            label="Локальный приоритет"
            placeholder="Все локальные приоритеты"
            value={priorityFilter}
            onChange={setPriorityFilter}
            disabled={!!rawTarget}
            options={filterOptions.priorities.map((v) => ({
              value: String(v),
              label: String(v),
            }))}
          />
          <MultiSelect
            label="Теги"
            placeholder="Все теги"
            value={tagFilter}
            onChange={setTagFilter}
            disabled={!!rawTarget}
            options={[
              { value: "", label: "Без тегов" },
              ...[...new Set<string>(filterTickets.flatMap((t: any) => t.tags || []))]
                .sort()
                .map((v) => ({ value: v, label: v })),
            ]}
          />
          <MultiSelect
            label="Azure теги"
            allowCustom={azureMode}
            placeholder="Все Azure теги"
            value={azureTagFilter}
            onChange={setAzureTagFilter}
            disabled={!!rawTarget}
            options={[
              { value: "", label: "Без Azure тегов" },
              ...[...new Set<string>(filterTickets.flatMap((t: any) => t.azureTags || []))]
                .sort()
                .map((v) => ({ value: v, label: v })),
            ]}
          />

          <MultiSelect
            label="Тип задачи"
            placeholder="Все типы"
            disabled={!!rawTarget}
            value={typeFilter}
            onChange={setTypeFilter}
            options={filterOptions.types.map((value) => ({
              value,
              label: value || "Тип не указан",
            }))}
          />
          <MultiSelect
            label="Статус"
            placeholder="Все статусы"
            disabled={!!rawTarget}
            value={stateFilter}
            onChange={setStateFilter}
            options={filterOptions.states.map((value) => ({
              value,
              label: value || "Статус не указан",
            }))}
          />
          <AzureAssigneeFilter
            disabled={!!rawTarget}
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            names={values("assigned")}
          />
          {hasLocalManagement(settings) && (
            <MultiSelect
              label="Локальное поручение"
              placeholder="Все разработчики"
              disabled={!!rawTarget}
              value={localFilter}
              onChange={setLocalFilter}
              options={[
                { value: "", label: "Нет поручения" },
                ...localDevelopers.map(([id, name]) => ({
                  value: id,
                  label: name,
                  avatarName: name,
                })),
              ]}
            />
          )}
        </div>
      </TicketFilterPanel>
      <div className="ticket-export-bar ticket-actions-panel">
        <div className="ticket-display-summary">
          {columns.control}
          {azureMode && (
            <ImportAzureTickets
              tickets={selection.selected}
              source={currentSource}
              onImported={() => {
                selection.clear();
                void run("refresh-azure-import", async () => {});
              }}
            />
          )}
          <p className="muted" role="status">
            {azureMode
              ? `На странице: ${sorted.length}`
              : `Показано ${sorted.length} из ${tickets.length}`}
          </p>
          {azureMode && <TicketColorLegend />}
        </div>
        <div className="ticket-bulk-actions">
          <span role="status">Выбрано: {selection.selected.length}</span>
          {!!selection.selected.length && (
            <button type="button" className="text-button" onClick={selection.clear}>
              Снять выбор
            </button>
          )}
          {!azureMode && (
            <BulkTicketStatus
              tickets={selection.selected}
              onChange={() => run("refresh-bulk-state", async () => {})}
            />
          )}
          <ExportTickets tickets={selection.selected} />
        </div>
      </div>
      {azureMode && (
        <>
          {browser.error && (
            <p className="error" role="alert">
              {browser.error}
            </p>
          )}
          {browser.pending(filters) && (
            <p className="muted">Условия изменены. Нажмите «Найти», чтобы применить их.</p>
          )}
          <nav className="azure-ticket-pagination" aria-label="Страницы Azure тикетов">
            <button
              type="button"
              className="secondary"
              disabled={browser.loading || browser.page === 1}
              onClick={browser.previous}
            >
              Назад
            </button>
            {paginationItems(browser.page, browser.totalPages).map((item) =>
              typeof item === "number" ? (
                <button
                  key={item}
                  type="button"
                  className="secondary azure-page-number"
                  aria-label={`Страница ${item}`}
                  aria-current={item === browser.page ? "page" : undefined}
                  disabled={browser.loading}
                  onClick={() => browser.goTo(item)}
                >
                  {item}
                </button>
              ) : (
                <span key={item} aria-hidden="true">
                  …
                </span>
              ),
            )}
            <button
              type="button"
              className="secondary"
              disabled={browser.loading || !browser.hasNext}
              onClick={browser.next}
            >
              Далее
            </button>
            <span>
              Страница {browser.page} из {browser.totalPages} · {browser.total} тикетов · по 50
            </span>
          </nav>
          {browser.limited && (
            <p className="muted">
              Показаны первые 20 000 результатов. Уточните фильтры, чтобы увидеть остальные.
            </p>
          )}
          <p className="muted">
            Сортировка — по всему результату поиска. Экспорт — выбранные тикеты; список можно
            дополнить в окне экспорта.
          </p>
        </>
      )}
      {!azureMode && (
        <p className="muted">
          {hasLocalManagement(settings)
            ? "Удаление и локальное поручение не изменяют Azure."
            : "Локальное удаление не изменяет Azure."}{" "}
          Удалённый тикет можно вернуть кнопкой «Добавить по номеру».
        </p>
      )}
      <div
        className={`panel ticket-table-fit ticket-active-table${sorted.length ? "" : " is-empty"}${columns.resize.manual ? " has-manual-widths" : ""}`}
      >
        <table ref={columns.resize.tableRef}>
          {columns.resize.colgroup}
          <thead>
            <tr>
              <OrderedTicketCells order={columns.order} headerResize={columns.resize.handle}>
                <th className="ticket-selection-column">
                  <SelectAllTickets
                    count={selection.selected.length}
                    total={sorted.length}
                    onChange={selection.toggleAll}
                  />
                </th>
                <th className="ticket-identity-column" aria-sort={columnSort(["id", "type"])}>
                  <div className="ticket-heading-sorts ticket-identity-heading">
                    {sortButton("id", "ID")}
                    {sortButton("type", "Тип")}
                  </div>
                </th>
                <th className="ticket-title-column" aria-sort={columnSort(["title"])}>
                  {sortButton("title", "Тикет")}
                </th>
                {(
                  [
                    ["state", "Статус"],
                    ["priority", "Локальный приоритет"],
                    ["azurePriority", "Azure приоритет"],
                    ["localDeadline", "Локальный дедлайн"],
                    ["tags", "Теги"],
                    ["azureTags", "Azure теги"],
                    ["assigned", "Исполнитель в Azure"],
                    ["developer_name", "Локальное поручение"],
                    ["created_at", "Дата создания"],
                    ["changed_at", "Дата изменения"],
                    ["added_at", "Добавлено в систему"],
                    ["synced_at", "Синхронизация"],
                  ] as const
                ).map(([key, label]) => (
                  <th
                    key={key}
                    data-column={key}
                    hidden={columns.hidden(key)}
                    aria-sort={columnSort([key])}
                  >
                    {sortButton(key, label)}
                  </th>
                ))}
                <th data-column="actions" hidden={columns.hidden("actions")}>
                  Просмотр
                </th>
              </OrderedTicketCells>
            </tr>
          </thead>
          <tbody>
            {!sorted.length && (
              <tr className="ticket-empty-row">
                <td colSpan={columns.count}>
                  <Empty
                    icon={Ticket}
                    title={
                      azureMode
                        ? browser.loading
                          ? "Поиск в Azure…"
                          : browser.searched
                            ? "Ничего не найдено"
                            : "Найдите тикеты в Azure"
                        : tickets.length
                          ? "Ничего не найдено"
                          : "Трекер пока пуст"
                    }
                    description={
                      azureMode
                        ? "Задайте условия и нажмите «Найти» или Enter. Без условий будут показаны все задачи проекта, по 50 на страницу."
                        : tickets.length
                          ? "Измените фильтры или поисковый запрос, либо нажмите «Сбросить»."
                          : "Добавьте тикет по номеру, импортируйте задачи по настроенным фильтрам или выберите упоминание во Входящих."
                    }
                  />
                </td>
              </tr>
            )}
            {sorted.map((t: any) => (
              <TicketDataRow
                key={`${t.source}:${t.id}`}
                ticket={t}
                columns={columns}
                settings={settings}
                context={context}
                checked={selection.checked(t)}
                onToggle={() => selection.toggle(t)}
                onChange={() => run("refresh-ticket", async () => {})}
                highlighted={targetId === t.id && !sourceMismatch}
                restoring={busy === "restore"}
                onRestore={
                  azureMode && t.inTrash
                    ? () =>
                        run(
                          "restore",
                          async () => {
                            await api(`/tickets/${t.id}/restore`, "POST", {
                              source: t.source,
                            });
                            window.dispatchEvent(
                              new CustomEvent("orbit:ticket-tracked", {
                                detail: { id: t.id, source: t.source },
                              }),
                            );
                          },
                          "Тикет восстановлен",
                        )
                    : undefined
                }
                onRemove={
                  azureMode && !t.imported
                    ? undefined
                    : () =>
                        run(
                          "remove",
                          () =>
                            api(`/tickets/${t.id}`, "DELETE", {
                              source: t.source,
                            }),
                          "Тикет перемещён в корзину на 30 дней",
                        )
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
