import { useEffect, useState } from "react";
import {
  ArchiveRestore,
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
  const [query, setQuery] = useState("");
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
        [t.id, t.title, t.type, t.state, t.assigned, localName(t)].some((v) =>
          String(v ?? "")
            .toLocaleLowerCase()
            .includes(q),
        ) &&
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
  const columns = [
    ["id", "ID"],
    ["title", "Тикет"],
    ["type", "Тип задачи"],
    ["state", "Статус"],
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
          disabled={!query && !types.length && !states.length && !people.length}
          onClick={() => {
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
        <p className="muted" role="status">
          Показано {filtered.length} из {items.length}
        </p>
      )}
      {loaded && !filtered.length && !error && (
        <div className="panel">
          <Trash2 size={22} />
          <h2>{items.length ? "Ничего не найдено" : "Корзина пуста"}</h2>
          {!!items.length && <p>Измените поиск или сбросьте фильтры.</p>}
        </div>
      )}
      {!!filtered.length && (
        <div className="table-wrap panel">
          <table>
            <thead>
              <tr>
                {columns.map(([key, label]) => (
                  <th
                    key={key}
                    aria-sort={
                      sort.key === key
                        ? sort.descending
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
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
                      {label}
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
                  </th>
                ))}
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={`${t.source}:${t.id}`}>
                  <td>
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
                  </td>
                  <td>
                    <strong>{t.title}</strong>
                  </td>
                  <td>
                    <StatusBadge
                      state={t.type || "Без типа"}
                      kind="type"
                      colors={settings?.typeColors}
                    />
                  </td>
                  <td>
                    <StatusBadge
                      state={t.state}
                      colors={settings?.statusColors}
                    />
                  </td>
                  <td>{t.assigned || "N/A"}</td>
                  <td>{localName(t) || "N/A"}</td>
                  <td>
                    <time dateTime={new Date(t.removedAt).toISOString()}>
                      {date(t.removedAt)}
                    </time>
                  </td>
                  <td>
                    <time dateTime={new Date(t.expiresAt).toISOString()}>
                      {date(t.expiresAt)}
                    </time>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy !== null}
                      onClick={() => void restore(t)}
                      aria-label={`Восстановить тикет #${t.id}`}
                    >
                      <ArchiveRestore size={17} />
                      {busy === t.id ? "Восстанавливаю…" : "Восстановить"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
