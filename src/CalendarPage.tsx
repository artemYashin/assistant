import { useCalendarClock } from "./useCalendarClock.js";
import { MultiSelect } from "./MultiSelect.js";
import { calendarMatchesStatus, calendarMatchesType } from "../server/calendar-model.js";
import { FilterPanel } from "./TicketFilterPanel.js";
import { parseCalendarFilters } from "./calendar-filters.js";
import { sortReminders } from "./calendar-sort.js";
import { ReminderLeadFields } from "./ReminderLeadFields.js";
import {
  occurrencesOnDay,
  recurringOverlaps,
} from "../server/calendar-repeat.js";
import { DailyCompletionButton } from "./DailyCompletionButton.js";
import { SingleSelect } from "./SingleSelect.js";
import { InitialsAvatar } from "./InitialsAvatar.js";
import { CalendarTimeGrid } from "./CalendarTimeGrid.js";
import { CalendarDateField } from "./CalendarDateField.js";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Palmtree,
  Ticket,
  Plus,
  ChevronLeft,
  ChevronRight,
  Check,
  Trash2,
  Pencil,
  X,
  Clock,
  Users,
  RotateCcw,
  Globe,
  Building2,
  Folder,
} from "lucide-react";
import { api } from "./api.js";
import { ConfirmButton } from "./ConfirmButton.js";
import {
  calendarOverlaps,
  calendarStatus,
  type CalendarItem,
} from "../server/calendar-model.js";
import { eventTime, fromWall, wallTime } from "./calendar-time.js";
import { statusLabels, calendarStatusLabel } from "./calendar-status.js";
export const calendarChanged = () =>
  window.dispatchEvent(new Event("orbit-calendar-changed"));
type Developer = { id: string; name: string; client: string; project: string };
const fresh = (day: string, context: { client: string; project: string }) => ({
  scope: (context.project
    ? "project"
    : context.client
      ? "client"
      : "general") as CalendarItem["scope"],
  client: context.client,
  project: context.project,
  notificationsHidden: false,
  calendarHidden: false,
  leadMinutes: null as number | null,
  repeatDaily: false,
  repeatWeekdays: [1, 2, 3, 4, 5, 6, 7],
  title: "",
  description: "",
  kind: "reminder" as CalendarItem["kind"],
  start: day ? day + "T09:00" : "",
  end: "",
  developerIds: [] as string[],
});
export function CalendarPage({
  settings,
  context,
}: {
  settings: any;
  context: { client: string; project: string };
}) {
  const [savedFilters] = useState(() => {
    try { return parseCalendarFilters(JSON.parse(localStorage.getItem("orbit.calendar.filters.current") || "null")); }
    catch { return parseCalendarFilters(null); }
  });
  const zone = settings?.syncSchedule?.timeZone || "UTC";
  const clock = useCalendarClock();
  const today = wallTime(new Date(clock).toISOString(), zone).slice(0, 10);
  const [nowRequest, setNowRequest] = useState(0);
  const [month, setMonth] = useState(today.slice(0, 7)),
    [view, setView] = useState(() => {
      try {
        const saved = localStorage.getItem("orbit.calendar.view");
        return saved && ["day", "week", "month"].includes(saved) ? saved : "week";
      } catch { return "week"; }
    }),
    [anchor, setAnchor] = useState(today),
    [contexts, setContexts] = useState<{ client: string; project: string }[]>(
      [],
    ),
    [clientFilter, setClientFilter] = useState(savedFilters.clientFilter),
    [projectFilter, setProjectFilter] = useState(savedFilters.projectFilter),
    [tab, setTab] = useState("calendar");
  useEffect(() => {
    try { localStorage.setItem("orbit.calendar.view", view); }
    catch { /* Keep navigation usable without persistent browser storage. */ }
  }, [view]);
  const [items, setItems] = useState<CalendarItem[]>([]),
    [developers, setDevelopers] = useState<Developer[]>([]);
  const [error, setError] = useState(""),
    [status, setStatus] = useState(savedFilters.status),
    [types, setTypes] = useState(savedFilters.types),
    [from, setFrom] = useState(savedFilters.from),
    [to, setTo] = useState(savedFilters.to),
    [query, setQuery] = useState(savedFilters.query);
  const [sort, setSort] = useState(savedFilters.sort);
  useEffect(() => {
    try { localStorage.setItem("orbit.calendar.filters.current", JSON.stringify({clientFilter, projectFilter, status, types, query, from, to, sort})); }
    catch { /* Filtering still works when browser storage is unavailable. */ }
  }, [clientFilter, projectFilter, status, types, query, from, to, sort]);
  const [draft, setDraft] = useState(fresh("", context)),
    [editing, setEditing] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    location = useLocation(),
    navigate = useNavigate();
  const selected = new URLSearchParams(location.search).get("event");
  const loadedSelection = useRef("");
  async function reload() {
    const data = await api("/calendar");
    setItems(data.items);
    setDevelopers(data.developers);
    setContexts(data.contexts);
  }
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (alive) reload().catch((e) => setError(e.message));
    };
    load();
    const timer = setInterval(() => {
      load();
      setTick((n) => n + 1);
    }, 30000);
    window.addEventListener("orbit-calendar-changed", load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("orbit-calendar-changed", load);
    };
  }, []);
  function openTicket(item: CalendarItem) {
    if (!item.ticket) return;
    dialog.current?.close();
    window.dispatchEvent(
      new CustomEvent("orbit-show-ticket-details", {
        detail: {
          source: item.ticket.source,
          tickets: [{ id: item.ticket.id, title: item.title }],
        },
      }),
    );
  }
  function open(item?: CalendarItem, day = "", time?: string) {
    if (item?.repeatDaily) item = items.find((i) => i.id === item!.id) || item;
    setEditing(item?.id || null);
    setDraft(
      item
        ? {
            ...item,
            notificationsHidden: !!item.notificationsHidden,
            calendarHidden: !!item.calendarHidden,
            leadMinutes: item.leadMinutes ?? null,
            repeatDaily: !!item.repeatDaily,
            repeatWeekdays: item.repeatWeekdays ?? [1, 2, 3, 4, 5, 6, 7],
            start: item.start ? wallTime(item.start, zone) : "",
            end: item.end ? wallTime(item.end, zone) : "",
          }
        : { ...fresh(day, context), start: time || (day ? day + "T09:00" : wallTime(new Date().toISOString(), zone)) },
    );
    dialog.current?.showModal();
  }
  useEffect(() => {
    if (!selected) {
      loadedSelection.current = "";
      return;
    }
    const item = items.find((i) => i.id === selected);
    if (item && loadedSelection.current !== selected) {
      loadedSelection.current = selected;
      setTab("reminders");
      setStatus([]); setTypes([]);
      setFrom("");
      setTo("");
      setQuery("");
      setClientFilter([]);
      setProjectFilter([]);
      open(item);
      setTimeout(
        () =>
          document
            .getElementById("event-" + selected)
            ?.scrollIntoView({ block: "center", behavior: "smooth" }),
        100,
      );
    }
  }, [selected, items]);
  const now = new Date().toISOString();
  let bounds: { from?: string; to?: string } = {},
    rangeError = "";
  try {
    bounds = {
      from: from ? fromWall(from, zone) : undefined,
      to: to ? fromWall(to, zone) : undefined,
    };
    if (bounds.from && bounds.to && bounds.from > bounds.to)
      rangeError = "Начало диапазона позже окончания.";
  } catch (e: any) {
    rangeError = e.message;
  }
  const filtered = rangeError
    ? []
    : items.filter((item) => {
        return (
          calendarMatchesStatus(item, status, now) &&
          calendarMatchesType(item, types) &&
          (!clientFilter.length || clientFilter.some(value => value === "none" ? !item.client : item.client === value.slice(1))) &&
          (!projectFilter.length || projectFilter.some(value => value === "none" ? !item.project : JSON.stringify([item.client, item.project]) === value)) &&
          item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
          (item.repeatDaily
            ? recurringOverlaps(item, bounds.from, bounds.to)
            : calendarOverlaps(item, bounds.from, bounds.to))
        );
      });
  const gridItems = filtered.filter(item => !item.calendarHidden);
  const base = new Date(month + "-01T12:00:00Z");
  const offset = (base.getUTCDay() + 6) % 7;
  const monthDays = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const days = Array.from(
    { length: Math.ceil((offset + monthDays) / 7) * 7 },
    (_, i) => {
      const d = new Date(base);
      d.setUTCDate(1 - offset + i);
      return d.toISOString().slice(0, 10);
    },
  );
  function shift(n: number) {
    if (view !== "month") {
      const date = new Date(anchor + "T12:00:00Z");
      date.setUTCDate(date.getUTCDate() + n * (view === "week" ? 7 : 1));
      setAnchor(date.toISOString().slice(0, 10));
      return;
    }
    const d = new Date(base);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
    setAnchor(d.toISOString().slice(0, 10));
  }
  async function mutate(path: string, method: string, body?: unknown) {
    await api(path, method, body);
    if (method === "DELETE")
      window.dispatchEvent(
        new CustomEvent("orbit:data-synced", { detail: { domain: "tickets" } }),
      );
    await reload();
    calendarChanged();
  }
  const currentItem = items.find((item) => item.id === editing);
  const validDraft =
    !!draft.title.trim() &&
    (draft.scope === "general" ||
      (!!draft.client && (draft.scope !== "project" || !!draft.project))) &&
    (!draft.end || (!!draft.start && draft.end >= draft.start));
  return (
    <section className="calendar-page">
      <div className="page-heading">
        <div>
          <h1>
            <CalendarDays size={26} /> Календарь
          </h1>
          <p>События и личные напоминания · {zone}</p>
        </div>
        <button className="primary" onClick={() => open()}>
          <Plus size={17} />
          Создать
        </button>
      </div>
      <div className="calendar-tabs" role="tablist" aria-label="Календарь">
        <button
          role="tab"
          aria-selected={tab === "calendar"}
          onClick={() => setTab("calendar")}
        >
          Календарь
        </button>
        <button
          role="tab"
          aria-selected={tab === "reminders"}
          onClick={() => setTab("reminders")}
        >
          Напоминания{" "}
          <span className="badge">
            {items.filter((i) => !i.completed).length}
          </span>
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
          <FilterPanel storageKey="orbit.calendar.filters" label="Наборы и фильтры напоминаний"
            filters={{clientFilter, projectFilter, status, types, query, from, to, sort}}
            parseFilters={parseCalendarFilters}
            onApply={(next) => { setClientFilter(next.clientFilter); setProjectFilter(next.projectFilter); setStatus(next.status); setTypes(next.types); setQuery(next.query); setFrom(next.from); setTo(next.to); setSort(next.sort); }}>
          <div className="calendar-filters">
            {tab === "reminders" && <SingleSelect
              label="Сортировка"
              value={sort}
              onChange={setSort}
              active={sort !== "nearest"}
              options={[
                { value: "nearest", label: "По ближайшей дате" },
                { value: "asc", label: "По дате: сначала ранние" },
                { value: "desc", label: "По дате: сначала поздние" },
                { value: "title", label: "По названию" },
              ]}
            />}
            <MultiSelect
              placeholder="Все типы"
              label="Тип"
              value={types}
              onChange={setTypes}
              options={[
                { value: "reminder", label: "Напоминание" },
                { value: "ticket", label: "Дедлайн тикета" },
                { value: "vacation", label: "Отпуск" },
              ]}
            />
            <MultiSelect
              placeholder="Все состояния"
              label="Состояние"
              value={status}
              onChange={setStatus}
              options={Object.entries({
                active: "Все активные",
                ...statusLabels,
              }).map(([value, label]) => ({ value, label }))}
            />
            <MultiSelect
              placeholder="Все заказчики"
              label="Заказчик"
              value={clientFilter}
              onChange={(value) => {
                setClientFilter(value);
                setProjectFilter([]);
              }}
              options={[
                { value: "none", label: "Без заказчика" },
                ...[...new Set(items.map((i) => i.client).filter(Boolean))]
                  .sort()
                  .map((name) => ({ value: "=" + name, label: name })),
              ]}
            />
            <MultiSelect
              placeholder="Все проекты"
              label="Проект"
              value={projectFilter}
              onChange={setProjectFilter}
              options={[
                { value: "none", label: "Без проекта" },
                ...Array.from(
                  new Map(
                    items
                      .filter(
                        (i) =>
                          i.project &&
                          (!clientFilter.length ||
                            clientFilter.includes("=" + i.client)),
                      )
                      .map((i) => [
                        JSON.stringify([i.client, i.project]),
                        {
                          value: JSON.stringify([i.client, i.project]),
                          label: i.project + " · " + i.client,
                        },
                      ]),
                  ).values(),
                ),
              ]}
            />
            <label>
              Поиск
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Название напоминания"
              />
            </label>
            <CalendarDateField
              zone={zone}
              label="С"
              value={from}
              onChange={setFrom}
            />
            <CalendarDateField
              zone={zone}
              label="По"
              value={to}
              onChange={setTo}
            />
            <button
              className="secondary ticket-filter-reset"
              onClick={() => {
                setSort("nearest");
                setClientFilter([]);
                setProjectFilter([]);
                setStatus([]); setTypes([]);
                setQuery("");
                setFrom("");
                setTo("");
              }}
            >
              Сбросить
            </button>
          </div>
          </FilterPanel>
          {(from || to) && (
            <p className="muted">
              Любое пересечение с диапазоном, включая границы. Напоминания без
              даты не входят в фильтр по времени.
            </p>
          )}
          {rangeError && <p className="error">{rangeError}</p>}
      {tab === "calendar" ? (
        <div className="calendar-board">
          <div className="calendar-toolbar">
            <div className="calendar-inline">
              <button
                className="icon-button"
                aria-label="Предыдущий период"
                onClick={() => shift(-1)}
              >
                <ChevronLeft size={18} />
              </button>
              <h2>
                {new Intl.DateTimeFormat("ru-RU", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(
                  view === "month" ? base : new Date(anchor + "T12:00:00Z"),
                )}
              </h2>
              <label className="calendar-jump" title="Перейти к дате">
                <input
                  aria-label="Перейти к дате"
                  type="date"
                  value={anchor}
                  onChange={(e) => {
                    if (e.target.value) {
                      setAnchor(e.target.value);
                      setMonth(e.target.value.slice(0, 7));
                    }
                  }}
                />
              </label>

              <button
                className="icon-button"
                aria-label="Следующий период"
                onClick={() => shift(1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="calendar-date-actions">
            <button
              className="secondary"
              onClick={() => {
                setMonth(today.slice(0, 7));
                setAnchor(today);
              }}
            >
              Сегодня
            </button>
            <button className="secondary" onClick={() => {
              const date = wallTime(new Date().toISOString(), zone).slice(0, 10);
              setMonth(date.slice(0, 7));
              setAnchor(date);
              if (view === "month") setView("day");
              setNowRequest(value => value + 1);
            }} title="Перейти к текущему времени">
              <Clock size={15} aria-hidden="true" /> Сейчас
            </button>
            </div>
          </div>
          <div
            className="calendar-view-switch"
            role="group"
            aria-label="Вид календаря"
          >
            {[
              ["month", "Месяц"],
              ["week", "Неделя"],
              ["day", "День"],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={view === key}
                onClick={() => {
                  setView(key);
                  if (key === "month") setMonth(anchor.slice(0, 7));
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="calendar-legend" aria-label="Цвета событий">
            <span className="calendar-state completed">Завершено</span>
            <span className="calendar-state upcoming">Не завершено</span>
            <span className="calendar-state overdue">Просрочено</span>
          </div>
          {view !== "month" ? (
            <CalendarTimeGrid
              items={gridItems}
              anchor={anchor}
              mode={view}
              zone={zone}
              nowRequest={nowRequest}
              onChange={(item) =>
                mutate("/calendar/" + item.id, "PUT", {
                  title: item.title,
                  description: item.description,
                  scope: item.scope,
                  client: item.client,
                  project: item.project,
                  repeatDaily: item.repeatDaily,
                  repeatWeekdays: item.repeatWeekdays,
                  start: item.start,
                  end: item.end,
                  developerIds: item.developerIds,
                })
              }
              onOpen={open}
              onCreate={(time) => open(undefined, "", time)}
            />
          ) : (
            <div className="calendar-grid">
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
                <div className="calendar-weekday" key={d}>
                  {d}
                </div>
              ))}
              {Array.from({length:days.length/7},(_,weekIndex) => {
                const week=days.slice(weekIndex*7,weekIndex*7+7);
                const vacations=gridItems.filter(item=>item.vacation && item.start && item.end && wallTime(item.start,zone).slice(0,10)<=week[6] && wallTime(item.end,zone).slice(0,10)>=week[0]);
                return <div className="calendar-month-week" key={week[0]}>
                {week.map((day) => {
                const entries = occurrencesOnDay(gridItems, day, zone).filter(
                  (i) =>
                    !i.vacation && i.start &&
                    wallTime(i.start, zone).slice(0, 10) <= day &&
                    (i.end
                      ? wallTime(i.end, zone).slice(0, 10)
                      : wallTime(i.start, zone).slice(0, 10)) >= day,
                );
                return (
                  <div
                    key={day}
                    className={`calendar-day ${day.slice(0, 7) !== month ? "outside" : ""} ${day === today ? "today" : day < today ? "is-past" : ""}`}
                  >
                    <button
                      aria-label={`Создать напоминание на ${day}`}
                      className="calendar-day-number"
                      title="Создать напоминание"
                      onClick={() => open(undefined, day)}
                    >
                      {Number(day.slice(-2))}
                      <Plus size={12} />
                    </button>
                    {entries.slice(0, 3).map((i) => (
                      <button
                        key={i.id + ":" + i.start}
                        className={"calendar-event " + calendarStatus(i, now) + (i.vacation ? " vacation" : "")}
                        onClick={() => open(i)}
                        title={i.title + " · " + calendarStatusLabel(i, now)}
                      >
                        <span>{i.vacation ? "Отпуск" : wallTime(i.start!, zone).slice(11)}</span>{" "}
                        {i.title}
                      </button>
                    ))}
                    {entries.length > 3 && (
                      <button
                        className="calendar-more"
                        onClick={() => {
                          setTab("reminders");
                          setFrom(day + "T00:00");
                          setTo(day + "T23:59");
                        }}
                      >
                        Ещё {entries.length - 3}
                      </button>
                    )}
                  </div>
                );
                })}
                {vacations.map((item,index)=>{
                  const first=wallTime(item.start!,zone).slice(0,10),last=wallTime(item.end!,zone).slice(0,10);
                  const left=week.findIndex(day=>day>=first);
                  const right=week.filter(day=>day<=last).length;
                  return <button key={item.id} className="calendar-vacation-band" style={{gridColumn:`${left+1} / ${right+1}`,gridRow:index+2}} onClick={()=>open(item)} title={`${item.title} · ${item.vacation!.start} — ${item.vacation!.end}`}>
                    <Palmtree size={13}/><span>{item.title} · {item.vacation!.start} — {item.vacation!.end}</span>
                  </button>;
                })}
                </div>;
              })}
            </div>
          )}
          <p className="muted calendar-footnote">
            Без срока: {filtered.filter((i) => !i.completed && !i.start).length}.
            Напоминания без даты доступны во вкладке «Напоминания».
          </p>
        </div>
      ) : (
        <>
          <div className="calendar-reminders">
            {sortReminders(filtered, sort, now).map((item) => (
              <article
                id={"event-" + item.id}
                key={item.id}
                className={`calendar-reminder ${selected === item.id ? "selected" : ""}`}
              >
                <div className="calendar-reminder-top">
                  <h3>{item.title}</h3>
                  <span
                    className={"calendar-state " + calendarStatus(item, now)}
                  >
                    {calendarStatusLabel(item, now)}
                  </span>
                </div>
                <p className="calendar-scope-badge">
                  {item.scope === "general" ? (
                    <Globe size={13} />
                  ) : item.scope === "client" ? (
                    <Building2 size={13} />
                  ) : (
                    <Folder size={13} />
                  )}{" "}
                  {item.scope === "general"
                    ? "Общий"
                    : [item.client, item.project].filter(Boolean).join(" / ")}
                </p>
                <p className="calendar-inline muted">
                  <Clock size={15} />
                  {item.ticket ? "Дедлайн: " : ""}
                  {eventTime(item.start, item.end, zone)}
                  {item.ticket && (
                    <span>
                      {" "}
                      · Предупреждать с:{" "}
                      {eventTime(item.warningStart || null, null, zone)}
                    </span>
                  )}
                </p>
                {item.description && (
                  <p className="calendar-description">{item.description}</p>
                )}
                {!!item.developerIds.length && (
                  <p className="calendar-inline">
                    <Users size={15} />
                    {item.developerIds.map((id) => {
                      const name =
                        developers.find((d) => d.id === id)?.name ||
                        "Удалённый разработчик";
                      return (
                        <span className="calendar-person" key={id}>
                          <InitialsAvatar name={name} />
                          {name}
                        </span>
                      );
                    })}
                  </p>
                )}
                <div className="calendar-inline calendar-reminder-actions">
                  {item.ticket && (
                    <button
                      className="secondary"
                      onClick={() => openTicket(item)}
                    >
                      <Ticket size={15} /> Открыть тикет
                    </button>
                  )}
                  <button className="secondary" onClick={() => open(item)}>
                    <Pencil size={15} />
                    {item.ticket || item.vacation ? "Открыть напоминание" : "Изменить"}
                  </button>
                  <DailyCompletionButton item={item} onChange={reload} />
                  {!item.completed && (
                    <ConfirmButton
                      title="Завершить напоминание?"
                      message={`«${item.title}». ${item.repeatDaily ? "Будет завершена вся ежедневная серия. " : ""}Напоминание останется в истории, уведомления прекратятся.`}
                      confirmLabel="Завершить"
                      onConfirm={() =>
                        mutate("/calendar/" + item.id + "/complete", "POST", {})
                      }
                    >
                      <Check size={15} />
                      {item.repeatDaily ? "Завершить всю серию" : "Завершить"}
                    </ConfirmButton>
                  )}
                  {item.completed && !(item.vacation && item.end && item.end < now) && (
                    <ConfirmButton
                      title="Вернуть в незавершённые?"
                      message={`«${item.title}» снова станет активным. Уведомления возобновятся с учётом времени начала и расписания.`}
                      confirmLabel="Вернуть в незавершённые"
                      onConfirm={() =>
                        mutate("/calendar/" + item.id + "/reopen", "POST", {})
                      }
                    >
                      <RotateCcw size={15} />
                      Вернуть в незавершённые
                    </ConfirmButton>
                  )}
                  {!item.ticket && !item.vacation && (
                    <ConfirmButton
                      title="Удалить напоминание?"
                      message={`«${item.title}» будет удалено без возможности восстановления.`}
                      confirmLabel="Удалить"
                      className="secondary calendar-delete"
                      onConfirm={() => mutate("/calendar/" + item.id, "DELETE")}
                    >
                      <Trash2 size={15} />
                      Удалить
                    </ConfirmButton>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <div className="empty">Напоминаний по выбранным условиям нет.</div>
          )}
        </>
      )}
      <dialog
        ref={dialog}
        className="calendar-editor"
        onClose={() => {
          if (selected) navigate("/calendar", { replace: true });
        }}
      >
        <div className="developer-dialog-heading">
          <h2>{editing ? "Напоминание" : "Новое напоминание"}</h2>
          <button
            className="icon-button"
            aria-label="Закрыть"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        {currentItem?.vacation && <div className="calendar-ticket-link"><strong>Отпуск разработчика</strong><p>{currentItem.vacation.start} — {currentItem.vacation.end} включительно · Возвращение {currentItem.vacation.returnDate}. Даты и отмена отпуска — в разделе «Разработчики → Настройки». Завершение напоминания отключает уведомления, но не отменяет отпуск.</p></div>}
        {currentItem?.ticket && (
          <div className="calendar-ticket-link">
            <strong>Дедлайн тикета #{currentItem.ticket.id}</strong>
            <p>
              {eventTime(currentItem.ticket.deadline, null, zone)} · изменяется
              в карточке тикета. Завершение напоминания сохраняет локальный
              дедлайн. Разработчики берутся из локальных поручений тикета и
              меняются там же.
            </p>
            <button
              className="secondary"
              onClick={() => openTicket(currentItem)}
            >
              Открыть тикет
            </button>
          </div>
        )}
        <fieldset
          disabled={!!currentItem?.ticket || !!currentItem?.vacation}
          className="calendar-editor-fields"
        >
          <section className="calendar-scope-editor">
            <span className="multi-select-label">Уровень напоминания</span>
            <div
              className="calendar-scope-tabs"
              role="group"
              aria-label="Уровень напоминания"
            >
              {(
                [
                  { value: "general", label: "Общий", Icon: Globe },
                  { value: "client", label: "Заказчик", Icon: Building2 },
                  { value: "project", label: "Проект", Icon: Folder },
                ] as const
              ).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  aria-pressed={draft.scope === value}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      scope: value,
                      client:
                        value === "general"
                          ? ""
                          : draft.client || context.client,
                      project:
                        value !== "project"
                          ? ""
                          : draft.project ||
                            ((draft.client || context.client) === context.client
                              ? context.project
                              : ""),
                    })
                  }
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
            {draft.scope !== "general" && (
              <div className="calendar-scope-selects">
                <SingleSelect
                  label="Заказчик напоминания"
                  value={draft.client}
                  options={[
                    { value: "", label: "Выберите заказчика" },
                    ...[
                      ...new Set(contexts.map((c) => c.client).filter(Boolean)),
                    ].map((name) => ({ value: name, label: name })),
                  ]}
                  onChange={(client) =>
                    setDraft({ ...draft, client, project: "" })
                  }
                />
                {draft.scope === "project" && (
                  <SingleSelect
                    label="Проект напоминания"
                    value={draft.project}
                    disabled={!draft.client}
                    options={[
                      { value: "", label: "Выберите проект" },
                      ...contexts
                        .filter((c) => c.client === draft.client && c.project)
                        .map((c) => ({ value: c.project, label: c.project })),
                    ]}
                    onChange={(project) => setDraft({ ...draft, project })}
                  />
                )}
              </div>
            )}
          </section>
          {draft.start && <p className="muted">Дата и время в часовом поясе {zone}</p>}
          <label>
            Название
            <input
              autoFocus
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="calendar-check">
            <input
              type="checkbox"
              checked={!draft.start}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  start: e.target.checked
                    ? ""
                    : wallTime(new Date().toISOString(), zone),
                  end: "",
                  repeatDaily: false,
                })
              }
            />
            <span>Без времени</span>
          </label>
          {draft.start && <>
          <div className="calendar-date-fields">
            <CalendarDateField
              zone={zone}
              label={
                currentItem?.ticket
                  ? "Дедлайн тикета"
                  : "Начало · необязательно"
              }
              value={draft.start}
              disabled={!draft.start}
              onChange={(start) =>
                setDraft({
                  ...draft,
                  start,
                  ...(!start ? { end: "", repeatDaily: false } : {}),
                })
              }
            />
            <CalendarDateField
              zone={zone}
              label="Окончание · необязательно"
              value={draft.end}
              min={draft.start}
              disabled={!draft.start}
              onChange={(end) => setDraft({ ...draft, end })}
            />
          </div>
          <label className="calendar-check">
            <input
              type="checkbox"
              checked={draft.repeatDaily}
              disabled={!draft.start}
              onChange={(e) =>
                setDraft({ ...draft, repeatDaily: e.target.checked })
              }
            />
            <span>Повторять каждый день</span>
          </label>
          {draft.repeatDaily && (
            <fieldset className="calendar-weekdays">
              <legend>Дни недели</legend>
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(
                (label, index) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={draft.repeatWeekdays.includes(index + 1)}
                      disabled={
                        draft.repeatWeekdays.length === 1 &&
                        draft.repeatWeekdays.includes(index + 1)
                      }
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          repeatWeekdays: e.target.checked
                            ? [...draft.repeatWeekdays, index + 1].sort()
                            : draft.repeatWeekdays.filter(
                                (day) => day !== index + 1,
                              ),
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ),
              )}
            </fieldset>
          )}
          {draft.repeatDaily && (
            <p className="muted">
              Одна запись в выбранные дни недели и время начиная с даты начала.
              Уведомления повторяются по интервалу из настроек, пока не
              завершена сегодняшняя итерация. «Завершить сегодня» отключит
              только сегодняшние уведомления; «Завершить всю серию» остановит
              все повторения. Изменения применяются ко всей серии;
              перетаскивание отключено.
            </p>
          )}
          <p className="muted">
            Без дат — напоминание без срока. Только начало — напоминание на
            время. Начало и окончание — событие с длительностью. Завершение
            всегда отмечается вручную.
          </p>
          </>}
          <label>
            Описание
            <textarea
              rows={3}
              maxLength={10000}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <details className="calendar-developers">
            <summary>
              <Users size={15} />
              Разработчики · необязательно ({draft.developerIds.length})
            </summary>
            {developers.map((d) => (
              <label className="calendar-check" key={d.id}>
                <input
                  type="checkbox"
                  checked={draft.developerIds.includes(d.id)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      developerIds: e.target.checked
                        ? [...draft.developerIds, d.id]
                        : draft.developerIds.filter((id) => id !== d.id),
                    })
                  }
                />
                <InitialsAvatar name={d.name} />
                <span>
                  {d.name}
                  <small>
                    {d.client
                      ? [d.client, d.project].filter(Boolean).join(" / ")
                      : "Общий список"}
                  </small>
                </span>
              </label>
            ))}
            {draft.developerIds
              .filter((id) => !developers.some((d) => d.id === id))
              .map((id) => (
                <label className="calendar-check" key={id}>
                  <input
                    type="checkbox"
                    checked
                    onChange={() =>
                      setDraft({
                        ...draft,
                        developerIds: draft.developerIds.filter(
                          (value) => value !== id,
                        ),
                      })
                    }
                  />
                  <span>
                    Удалённый разработчик · снимите выбор для сохранения
                  </span>
                </label>
              ))}
            {!developers.length && (
              <p className="muted">Локальные разработчики пока не добавлены.</p>
            )}
          </details>
        </fieldset>
        <label className="calendar-check">
          <input type="checkbox" checked={draft.notificationsHidden}
            onChange={e => setDraft({ ...draft, notificationsHidden: e.target.checked })} />
          <span>Не показывать в уведомлениях</span>
        </label>
        <label className="calendar-check">
          <input type="checkbox" checked={draft.calendarHidden}
            onChange={e => setDraft({ ...draft, calendarHidden: e.target.checked })} />
          <span>Не показывать в календаре</span>
        </label>
        {draft.start && <ReminderLeadFields
          value={draft.leadMinutes}
          fallback={
            currentItem?.vacation ? settings.calendarNotifications.vacationLeadMinutes : currentItem?.ticket
              ? settings.calendarNotifications.ticketDeadlineLeadMinutes
              : settings.calendarNotifications.reminderLeadMinutes
          }
          onChange={(leadMinutes) => setDraft({ ...draft, leadMinutes })}
        />}
        {currentItem && (
          <div className="calendar-editor-management">
            <span
              className={"calendar-state " + calendarStatus(currentItem, now)}
            >
              {calendarStatusLabel(currentItem, now)}
            </span>
            <div className="calendar-inline">
              <DailyCompletionButton item={currentItem} onChange={reload} />
              <ConfirmButton
                disabled={!!(currentItem.vacation && currentItem.end && currentItem.end < now)}
                title={
                  currentItem.completed
                    ? "Вернуть в незавершённые?"
                    : "Завершить напоминание?"
                }
                message={`«${currentItem.title}». ${currentItem.repeatDaily ? "Действие применяется ко всей ежедневной серии. " : ""} ${currentItem.completed ? "Уведомления снова будут работать по расписанию." : "Напоминание останется в календаре, уведомления прекратятся."} Несохранённые изменения формы не применятся.`}
                confirmLabel={currentItem.completed ? "Вернуть" : "Завершить"}
                onConfirm={async () => {
                  await mutate(
                    "/calendar/" +
                      currentItem.id +
                      (currentItem.completed ? "/reopen" : "/complete"),
                    "POST",
                    {},
                  );
                  dialog.current?.close();
                }}
              >
                {currentItem.completed ? (
                  <RotateCcw size={15} />
                ) : (
                  <Check size={15} />
                )}
                {currentItem.completed
                  ? "Вернуть в незавершённые"
                  : currentItem.repeatDaily
                    ? "Завершить всю серию"
                    : "Завершить"}
              </ConfirmButton>
              {!currentItem.ticket && !currentItem.vacation && (
                <ConfirmButton
                  className="calendar-delete"
                  title="Удалить напоминание?"
                  message={`«${currentItem.title}» будет удалено без возможности восстановления.`}
                  confirmLabel="Удалить"
                  onConfirm={async () => {
                    await mutate("/calendar/" + currentItem.id, "DELETE");
                    dialog.current?.close();
                  }}
                >
                  <Trash2 size={15} />
                  Удалить
                </ConfirmButton>
              )}
            </div>
          </div>
        )}
        <div className="dialog-actions">
          <button className="secondary" onClick={() => dialog.current?.close()}>
            Отмена
          </button>
          <ConfirmButton
            disabled={!validDraft || (!!editing && !currentItem)}
            className="primary"
            title={editing ? "Сохранить изменения?" : "Создать напоминание?"}
            message={`«${draft.title}» · ${!draft.start ? "Без срока" : draft.start.replace("T", " ") + " · " + zone}`}
            confirmLabel={editing ? "Сохранить" : "Создать"}
            onConfirm={async () => {
              if (currentItem?.ticket || currentItem?.vacation) {
                await mutate(`/calendar/${currentItem.id}/warning`, "PUT", {
                  notificationsHidden: draft.notificationsHidden,
                  calendarHidden: draft.calendarHidden,
                  leadMinutes: draft.leadMinutes,
                });
                dialog.current?.close();
                return;
              }
              await mutate(
                "/calendar" + (editing ? "/" + editing : ""),
                editing ? "PUT" : "POST",
                {
                  notificationsHidden: draft.notificationsHidden,
                  calendarHidden: draft.calendarHidden,
                  leadMinutes: draft.leadMinutes,
                  repeatDaily: draft.repeatDaily,
                  repeatWeekdays: draft.repeatWeekdays,
                  title: draft.title,
                  description: draft.description,
                  scope: draft.scope,
                  client: draft.client,
                  project: draft.project,
                  start: draft.start ? fromWall(draft.start, zone) : null,
                  end: draft.end ? fromWall(draft.end, zone) : null,
                  developerIds: draft.developerIds,
                },
              );
              dialog.current?.close();
            }}
          >
            <Check size={16} />
            {editing ? "Сохранить" : "Создать"}
          </ConfirmButton>
        </div>
      </dialog>
    </section>
  );
}
