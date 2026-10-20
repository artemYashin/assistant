import { OrderedTicketCells, useTicketColumns } from "./TicketColumns.js";
import { useSearchParams } from "react-router-dom";
import { LocalAssigneeNames } from "./LocalAssigneeNames.js";
import { SelectAllTickets, useTicketSelection } from "./TicketSelection.js";
import { ExportTickets } from "./ExportTickets.js";
import { PrInfoPopup } from "./PrInfoPopup.js";
import { NotebookPen } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ArchiveRestore,
  LoaderCircle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Search,
  Trash2,
} from "lucide-react";
import { MultiSelect } from "./MultiSelect.js";
import { api } from "./api.js";
import { StatusBadge } from "./TicketControls.js";
export function TicketTrash({
  onChange,
  settings,
}: {
  onChange: () => void;
  settings?: any;
}) {
  const display = useTicketColumns(true);
  const [items, setItems] = useState<any[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<number | null>(null),
    [version, setVersion] = useState(0);
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
  const [query, setQuery] = useState(params.get("id") || "");
  const [priorities, setPriorities] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [sort, setSort] = useState({ key: "removedAt", descending: true });
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
  const selectedPeople = people.map((p) => JSON.parse(p));
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
        (!types.length || types.includes(t.type || "")) &&
        (!states.length || states.includes(t.state || "")) &&
        (!people.length ||
          selectedPeople.some(([kind, value]) =>
            kind === "azure"
              ? (t.assigned || "") === value
              : value
                ? (t.developers || []).some((d: any) => d.id === value)
                : !(t.developers || []).length,
          ))
      );
    })
    .sort((a, b) => {
      const value = (t: any) =>
        sort.key === "developer_name" ? localName(t) : t[sort.key];
      const cmp = ["id", "removedAt", "expiresAt"].includes(sort.key)
        ? Number(value(a)) - Number(value(b))
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
    ["priority", "Приоритет"],
    ["tags", "Теги"],
    ["assigned", "Исполнитель в Azure"],
    ["developer_name", "Локальное поручение"],
    ["removedAt", "Удалён"],
    ["expiresAt", "Хранится до"],
  ];
  const date = (value: number) => new Date(value).toLocaleString("ru-RU");
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
        Данные сохранены на момент удаления. Azure не изменяется.
      </p>
      <div className="toolbar">
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
      <div className="ticket-filters">
        <MultiSelect
          label="Приоритет"
          placeholder="Все приоритеты"
          value={priorities}
          onChange={setPriorities}
          options={[...new Set<number>(items.map((t) => t.priority ?? 1))]
            .sort((a, b) => a - b)
            .map((v) => ({ value: String(v), label: "P" + v }))}
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
          label="Тип задачи"
          placeholder="Все типы"
          value={types}
          onChange={setTypes}
          options={values("type").map((value) => ({
            value,
            label: value || "Тип не указан",
          }))}
        />
        <MultiSelect
          label="Статус"
          placeholder="Все статусы"
          value={states}
          onChange={setStates}
          options={values("state").map((value) => ({
            value,
            label: value || "Статус не указан",
          }))}
        />
        <MultiSelect
          label="Исполнитель"
          placeholder="Все исполнители"
          value={people}
          onChange={setPeople}
          options={[
            ...values("assigned").map((name) => ({
              value: JSON.stringify(["azure", name]),
              label: name || "Не назначен в Azure",
              group: "Назначен в Azure",
            })),
            {
              value: JSON.stringify(["local", ""]),
              label: "Нет локального поручения",
              group: "Локальное поручение",
            },
            ...localOptions.map(([id, name]) => ({
              value: JSON.stringify(["local", id]),
              label: name,
              group: "Локальное поручение",
            })),
          ]}
        />
        <button
          className="secondary"
          disabled={
            !query &&
            !types.length &&
            !states.length &&
            !people.length &&
            !priorities.length &&
            !tags.length
          }
          onClick={() => {
            setPriorities([]);
            setTags([]);
            setQuery("");
            setTypes([]);
            setStates([]);
            setPeople([]);
          }}
        >
          Сбросить фильтры
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!loaded ? (
        <p role="status">Загрузка корзины…</p>
      ) : (
        <div className="ticket-export-bar">
          <div className="ticket-display-summary">
            {display.control}
            <p className="muted" role="status">
              Показано {filtered.length} из {items.length}
            </p>
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
            <ExportTickets
              tickets={
                selection.selected.length ? selection.selected : filtered
              }
              trash
            />
          </div>
        </div>
      )}
      {loaded && !filtered.length && !error && (
        <div className="panel">
          <Trash2 size={22} />
          <h2>{items.length ? "Ничего не найдено" : "Корзина пуста"}</h2>
          {!!items.length && <p>Измените поиск или сбросьте фильтры.</p>}
        </div>
      )}
      {!!filtered.length && (
        <div className="panel ticket-table-fit ticket-trash-table">
          <table>
            <thead>
              <tr>
                <OrderedTicketCells order={display.order}>
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
                      data-column={
                        key === "id" || key === "title" ? undefined : key
                      }
                      hidden={display.hidden(key)}
                      aria-sort={
                        sort.key === key ||
                        (key === "id" && sort.key === "type")
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
                              <span>Тип задачи</span>
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
              {filtered.map((t) => (
                <tr key={`${t.source}:${t.id}`}>
                  <OrderedTicketCells order={display.order}>
                    <td className="ticket-selection-column">
                      <input
                        className="ticket-checkbox"
                        type="checkbox"
                        aria-label={`Выбрать тикет #${t.id}`}
                        checked={selection.checked(t)}
                        onChange={() => selection.toggle(t)}
                      />
                    </td>
                    <td hidden={display.hidden("id")}>
                      <div className="ticket-id-type">
                        {t.url?.startsWith("https://") ? (
                          <a
                            className="ticket-link"
                            href={t.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            #{t.id}
                          </a>
                        ) : (
                          `#${t.id}`
                        )}
                        <StatusBadge
                          state={t.type || "Без типа"}
                          kind="type"
                          colors={settings?.typeColors}
                        />
                      </div>
                    </td>
                    <td hidden={display.hidden("title")}>
                      <strong className="ticket-title-clamp" title={t.title}>
                        {t.title}
                      </strong>
                    </td>
                    <td data-column="state" hidden={display.hidden("state")}>
                      <StatusBadge
                        state={t.state}
                        colors={settings?.statusColors}
                      />
                    </td>
                    <td
                      data-column="priority"
                      hidden={display.hidden("priority")}
                    >
                      <span className="badge ticket-priority-badge">
                        P{t.priority ?? 1}
                      </span>
                    </td>
                    <td data-column="tags" hidden={display.hidden("tags")}>
                      <div className="ticket-tag-list">
                        {(t.tags || []).map((tag: string) => (
                          <span className="badge" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td
                      data-column="assigned"
                      hidden={display.hidden("assigned")}
                    >
                      <LocalAssigneeNames
                        names={t.assigned ? [t.assigned] : []}
                        emptyLabel="Не назначен"
                      />
                    </td>
                    <td
                      data-column="developer_name"
                      hidden={display.hidden("developer_name")}
                    >
                      <LocalAssigneeNames
                        names={
                          t.developers?.length
                            ? t.developers.map((d: any) => d.name)
                            : t.developer_name
                              ? [t.developer_name]
                              : []
                        }
                      />
                    </td>
                    <td
                      data-column="removedAt"
                      hidden={display.hidden("removedAt")}
                    >
                      <time dateTime={new Date(t.removedAt).toISOString()}>
                        {date(t.removedAt)}
                      </time>
                    </td>
                    <td
                      data-column="expiresAt"
                      hidden={display.hidden("expiresAt")}
                    >
                      <time dateTime={new Date(t.expiresAt).toISOString()}>
                        {date(t.expiresAt)}
                      </time>
                    </td>
                    <td
                      data-column="actions"
                      hidden={display.hidden("actions")}
                    >
                      <div className="ticket-trash-actions">
                        <PrInfoPopup
                          title={`Заметки тикета #${t.id}`}
                          trigger={<NotebookPen size={17} />}
                        >
                          <p style={{ whiteSpace: "pre-wrap" }}>
                            {t.notes || "Заметок нет"}
                          </p>
                        </PrInfoPopup>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy !== null}
                          onClick={() => void restore(t)}
                          aria-label={`Восстановить тикет #${t.id}`}
                          title={
                            busy === t.id
                              ? "Восстанавливаю…"
                              : "Восстановить тикет"
                          }
                          aria-busy={busy === t.id}
                        >
                          {busy === t.id ? (
                            <LoaderCircle className="spin" size={17} />
                          ) : (
                            <ArchiveRestore size={17} />
                          )}
                        </button>
                      </div>
                    </td>
                  </OrderedTicketCells>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
