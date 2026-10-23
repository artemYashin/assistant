import { TicketColorLegend } from "./TicketColorLegend.js";
import { BulkTicketStatus } from "./BulkTicketStatus.js";
import { TicketDataRow } from "./TicketDataRow.js";
import { useTicketFilterOptions } from "./useTicketFilterOptions.js";
import { parseTicketFilters, useTicketFilters } from "./useTicketFilters.js";
import { TicketFilterPanel } from "./TicketFilterPanel.js";
import { RotateCcw } from "lucide-react";
import { OrderedTicketCells, useTicketColumns } from "./TicketColumns.js";
import { useSearchParams } from "react-router-dom";
import { SelectAllTickets, useTicketSelection } from "./TicketSelection.js";
import { ExportTickets } from "./ExportTickets.js";
import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, Search, Trash2 } from "lucide-react";
import { MultiSelect } from "./MultiSelect.js";
import { AzureAssigneeFilter } from "./AzureAssigneeFilter.js";
import { api } from "./api.js";
export function TicketTrash({
  context,
  onChange,
  settings,
}: {
  onChange: () => void;
  context: { client: string; project: string };
  settings?: any;
}) {
  const display = useTicketColumns(true);
  const [items, setItems] = useState<any[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<number | null>(null),
    [version, setVersion] = useState(0);
  const filterOptions = useTicketFilterOptions(context, settings, items);
  useEffect(() => {
    let live = true;
    api("/tickets/trash")
      .then((rows) => {
        if (live) {
          setItems(rows);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoaded(true);
        }
      });
    return () => {
      live = false;
    };
  }, [version]);
  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    const events = [
      "orbit:ticket-state",
      "orbit:ticket-assignee",
      "orbit:ticket-metadata",
      "orbit:ticket-developers",
      "orbit:ticket-tracked",
    ];
    events.forEach((name) => window.addEventListener(name, refresh));
    return () =>
      events.forEach((name) => window.removeEventListener(name, refresh));
  }, []);
  async function restore(t: any) {
    setBusy(t.id);
    setError("");
    try {
      await api(`/tickets/${t.id}/restore`, "POST", { source: t.source });
      setItems((old) => old.filter((i) => i.id !== t.id));
      onChange();
    } catch (e: any) {
      setError(e.message);
      setVersion((v) => v + 1);
    } finally {
      setBusy(null);
    }
  }
  const [params] = useSearchParams();
  const currentSource = `${(settings?.azureUrl || "").replace(/\/$/, "")}|${settings?.azureProject || ""}`;
  const filterStorageKey =
    "orbit.ticket-filters.trash:" +
    JSON.stringify([currentSource, context.client, context.project]);
  const {
    filters,
    set: setFilter,
    apply: applyFilters,
  } = useTicketFilters(filterStorageKey, {
    query: params.get("id") || "",
    sort: "removedAt-desc",
  });
  useEffect(() => {
    const id = params.get("id");
    if (id) {
      // Links from developer cards must not be hidden by persisted filters.
      applyFilters(parseTicketFilters({ query: id, sort: "removedAt-desc" }));
    }
  }, [params]);
  const {
    query,
    priorityFilter: priorities,
    tagFilter: tags,
    azureTagFilter: azureTags,
    typeFilter: types,
    stateFilter: states,
    assigneeFilter: people,
    localFilter,
  } = filters;
  const setQuery = (value: string) => setFilter("query", value);
  const setPriorities = (value: string[]) => setFilter("priorityFilter", value);
  const setTags = (value: string[]) => setFilter("tagFilter", value);
  const setAzureTags = (value: string[]) => setFilter("azureTagFilter", value);
  const setTypes = (value: string[]) => setFilter("typeFilter", value);
  const setStates = (value: string[]) => setFilter("stateFilter", value);
  const setPeople = (value: string[]) => setFilter("assigneeFilter", value);
  const setLocalFilter = (value: string[]) => setFilter("localFilter", value);
  const sort = {
    key: filters.sort.replace(/-(asc|desc)$/, ""),
    descending: filters.sort.endsWith("-desc"),
  };
  const setSort = (value: typeof sort) =>
    setFilter("sort", `${value.key}-${value.descending ? "desc" : "asc"}`);
  const localName = (t: any) =>
    t.developers?.map((d: any) => d.name).join(", ") || t.developer_name || "";
  const values = (key: string) =>
    [...new Set<string>(items.map((t) => t[key] || ""))].sort((a, b) =>
      a.localeCompare(b, "ru"),
    );
  const localOptions = [
    ...new Map<string, string>(
      items.flatMap((t) =>
        (t.developers || []).map(
          (d: any) => [d.id, d.name] as [string, string],
        ),
      ),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  const filtered = items
    .filter((t) => {
      const q = query.trim().toLocaleLowerCase();
      return (
        [
          t.id,
          t.title,
          t.type,
          t.state,
          t.assigned,
          localName(t),
          t.notes,
          t.tags,
          t.azureTags,
        ].some((v) =>
          String(v ?? "")
            .toLocaleLowerCase()
            .includes(q),
        ) &&
        (!priorities.length || priorities.includes(String(t.priority ?? 1))) &&
        (!tags.length ||
          tags.some((tag) =>
            tag === "" ? !t.tags?.length : t.tags?.includes(tag),
          )) &&
        (!azureTags.length ||
          azureTags.some((tag) =>
            tag === "" ? !t.azureTags?.length : t.azureTags?.includes(tag),
          )) &&
        (!types.length || types.includes(t.type || "")) &&
        (!states.length || states.includes(t.state || "")) &&
        (!people.length || people.includes(t.assigned || "")) &&
        (!localFilter.length ||
          localFilter.some((id) =>
            id === ""
              ? !t.developers?.length
              : t.developers?.some((d: any) => d.id === id),
          ))
      );
    })
    .sort((a, b) => {
      const value = (t: any) =>
        sort.key === "developer_name" ? localName(t) : t[sort.key];
      if(sort.key==="azurePriority") {
        if(value(a)==null || value(b)==null) return value(a)==null ? (value(b)==null ? a.id-b.id : 1) : -1;
        return (sort.descending ? value(b)-value(a) : value(a)-value(b)) || a.id-b.id;
      }
      const cmp = ["id", "removedAt", "expiresAt"].includes(sort.key)
        ? Number(value(a)) - Number(value(b))
        : ["created_at", "changed_at"].includes(sort.key)
          ? (Date.parse(value(a)) || 0) - (Date.parse(value(b)) || 0)
          : String(value(a) || "").localeCompare(String(value(b) || ""), "ru", {
              numeric: true,
            });
      return (sort.descending ? -cmp : cmp) || a.id - b.id;
    });
  const selection = useTicketSelection(
    filtered,
    JSON.stringify([settings?.azureUrl, settings?.azureProject]),
  );
  const columns = [
    ["id", "ID"],
    ["title", "Тикет"],
    ["state", "Статус"],
    ["priority", "Локальный приоритет"],
    ["azurePriority", "Azure приоритет"],
    ["tags", "Теги"],
    ["azureTags", "Azure теги"],
    ["assigned", "Исполнитель в Azure"],
    ["developer_name", "Локальное поручение"],
    ["created_at", "Дата создания"],
    ["changed_at", "Дата изменения"],
    ["added_at", "Добавлено в систему"],
    ["synced_at", "Синхронизация"],
    ["removedAt", "Удалён"],
    ["expiresAt", "Хранится до"],
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Корзина тикетов</h1>
          <p>
            Снимки хранятся 30 дней после удаления. Можно восстановить тикет
            вместе с локальными поручениями.
          </p>
        </div>
      </div>
      <p className="muted">
        Статус и исполнитель изменяются в Azure. Заметки, приоритет и поручения
        сохраняются локально.
      </p>
      <div className="ticket-management-toolbar">
        <div className="ticket-search-block">
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Поиск в корзине"
              placeholder="Номер, название, исполнитель…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      </div>
      <TicketFilterPanel
        storageKey={filterStorageKey}
        filters={filters}
        onApply={applyFilters}
        disabled={false}
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
              setPriorities([]);
              setTags([]);
              setAzureTags([]);
              setQuery("");
              setTypes([]);
              setStates([]);
              setPeople([]);
              setLocalFilter([]);
            }}
          >
            <RotateCcw size={15} /> Сбросить
          </button>
          <MultiSelect
            label="Локальный приоритет"
            placeholder="Все локальные приоритеты"
            value={priorities}
            onChange={setPriorities}
            options={filterOptions.priorities.map((v) => ({
              value: String(v),
              label: String(v),
            }))}
          />
          <MultiSelect
            label="Теги"
            placeholder="Все теги"
            value={tags}
            onChange={setTags}
            options={[
              { value: "", label: "Без тегов" },
              ...[...new Set<string>(items.flatMap((t) => t.tags || []))]
                .sort()
                .map((v) => ({ value: v, label: v })),
            ]}
          />
          <MultiSelect
            label="Azure теги"
            placeholder="Все Azure теги"
            value={azureTags}
            onChange={setAzureTags}
            options={[
              { value: "", label: "Без Azure тегов" },
              ...[...new Set<string>(items.flatMap((t) => t.azureTags || []))]
                .sort()
                .map((v) => ({ value: v, label: v })),
            ]}
          />

          <MultiSelect
            label="Тип задачи"
            placeholder="Все типы"
            value={types}
            onChange={setTypes}
            options={filterOptions.types.map((value) => ({
              value,
              label: value || "Тип не указан",
            }))}
          />
          <MultiSelect
            label="Статус"
            placeholder="Все статусы"
            value={states}
            onChange={setStates}
            options={filterOptions.states.map((value) => ({
              value,
              label: value || "Статус не указан",
            }))}
          />
          <AzureAssigneeFilter
            value={people}
            onChange={setPeople}
            names={values("assigned")}
          />
          <MultiSelect
            label="Локальное поручение"
            placeholder="Все разработчики"
            value={localFilter}
            onChange={setLocalFilter}
            options={[
              { value: "", label: "Нет поручения" },
              ...localOptions.map(([id, name]) => ({
                value: id,
                label: name,
                avatarName: name,
              })),
            ]}
          />
        </div>
      </TicketFilterPanel>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!loaded ? (
        <p role="status">Загрузка корзины…</p>
      ) : (
        <div className="ticket-export-bar ticket-actions-panel">
          <div className="ticket-display-summary">
            {display.control}
            <p className="muted" role="status">
              Показано {filtered.length} из {items.length}
            </p>
            <TicketColorLegend />
          </div>
          <div className="ticket-bulk-actions">
            <span role="status">Выбрано: {selection.selected.length}</span>
            {!!selection.selected.length && (
              <button
                type="button"
                className="text-button"
                onClick={selection.clear}
              >
                Снять выбор
              </button>
            )}
            <BulkTicketStatus
              tickets={selection.selected}
              onChange={() => {
                setVersion((v) => v + 1);
                onChange();
              }}
            />
            <ExportTickets
              tickets={
                selection.selected
              }
              trash
            />
          </div>
        </div>
      )}
      <div
        className={`panel ticket-table-fit ticket-trash-table${filtered.length ? "" : " is-empty"}${display.resize.manual ? " has-manual-widths" : ""}`}
      >
        <table ref={display.resize.tableRef}>
          {display.resize.colgroup}
          <thead>
            <tr>
              <OrderedTicketCells
                order={display.order}
                headerResize={display.resize.handle}
              >
                <th className="ticket-selection-column">
                  <SelectAllTickets
                    count={selection.selected.length}
                    total={filtered.length}
                    onChange={selection.toggleAll}
                  />
                </th>
                {columns.map(([key, label]) => (
                  <th
                    key={key}
                    className={
                      key === "title"
                        ? "ticket-title-column"
                        : key === "id"
                          ? "ticket-identity-column"
                          : undefined
                    }
                    data-column={
                      key === "id" || key === "title" ? undefined : key
                    }
                    hidden={display.hidden(key)}
                    aria-sort={
                      sort.key === key || (key === "id" && sort.key === "type")
                        ? sort.descending
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <div className="ticket-heading-sorts">
                      <button
                        type="button"
                        className={`ticket-column-sort${sort.key === key ? " is-active" : ""}`}
                        aria-label={`Сортировать: ${label}, ${sort.key === key && !sort.descending ? "по убыванию" : "по возрастанию"}`}
                        onClick={() =>
                          setSort({
                            key,
                            descending: sort.key === key && !sort.descending,
                          })
                        }
                      >
                        <span>{label}</span>
                        {sort.key === key ? (
                          sort.descending ? (
                            <ArrowDown size={13} />
                          ) : (
                            <ArrowUp size={13} />
                          )
                        ) : (
                          <ArrowUpDown size={13} />
                        )}
                      </button>
                      {key === "id" && (
                        <>
                          <span aria-hidden="true">/</span>
                          <button
                            type="button"
                            className={`ticket-column-sort${sort.key === "type" ? " is-active" : ""}`}
                            aria-label="Сортировать: Тип задачи"
                            onClick={() =>
                              setSort({
                                key: "type",
                                descending:
                                  sort.key === "type" && !sort.descending,
                              })
                            }
                          >
                            <span>Тип</span>
                            {sort.key === "type" ? (
                              sort.descending ? (
                                <ArrowDown size={13} />
                              ) : (
                                <ArrowUp size={13} />
                              )
                            ) : (
                              <ArrowUpDown size={13} />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </th>
                ))}
                <th data-column="actions" hidden={display.hidden("actions")}>
                  Действия
                </th>
              </OrderedTicketCells>
            </tr>
          </thead>
          <tbody>
            {!filtered.length && (
              <tr className="ticket-empty-row">
                <td colSpan={display.count}>
                  <div className="ticket-empty-message" role="status">
                    <Trash2 size={22} aria-hidden="true" />
                    <strong>
                      {!loaded
                        ? "Загрузка корзины…"
                        : error
                          ? "Не удалось загрузить корзину"
                          : items.length
                            ? "Ничего не найдено"
                            : "Корзина пуста"}
                    </strong>
                    {loaded && !error && !!items.length && (
                      <span>Измените поиск или сбросьте фильтры.</span>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {filtered.map((t) => (
              <TicketDataRow
                key={`${t.source}:${t.id}`}
                ticket={{ ...t, inTrash: true }}
                columns={display}
                settings={settings}
                context={context}
                checked={selection.checked(t)}
                onToggle={() => selection.toggle(t)}
                onChange={() => {
                  setVersion((v) => v + 1);
                  onChange();
                }}
                onRestore={() => void restore(t)}
                restoring={busy !== null}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
