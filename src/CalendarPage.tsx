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
export const statusLabels: Record<string, string> = {
  recurring: "Ежедневно",
  today_completed: "Сегодня завершено",
  open: "Без срока",
  upcoming: "Предстоит",
  ongoing: "Идёт сейчас",
  overdue: "Просрочено",
  completed: "Завершено",
};
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
  leadMinutes: null as number | null,
  repeatDaily: false,
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
  const zone = settings?.syncSchedule?.timeZone || "UTC";
  const today = wallTime(new Date().toISOString(), zone).slice(0, 10);
  const [month, setMonth] = useState(today.slice(0, 7)),
    [view, setView] = useState("week"),
    [anchor, setAnchor] = useState(today),
    [contexts, setContexts] = useState<{ client: string; project: string }[]>(
      [],
    ),
    [clientFilter, setClientFilter] = useState("all"),
    [projectFilter, setProjectFilter] = useState("all"),
    [tab, setTab] = useState("calendar");
  const [items, setItems] = useState<CalendarItem[]>([]),
    [developers, setDevelopers] = useState<Developer[]>([]);
  const [error, setError] = useState(""),
    [status, setStatus] = useState("all"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [query, setQuery] = useState("");
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
            leadMinutes: item.leadMinutes ?? null,
            repeatDaily: !!item.repeatDaily,
            start: item.start ? wallTime(item.start, zone) : "",
            end: item.end ? wallTime(item.end, zone) : "",
          }
        : { ...fresh(day, context), ...(time ? { start: time } : {}) },
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
      setStatus("all");
      setFrom("");
      setTo("");
      setQuery("");
      setClientFilter("all");
      setProjectFilter("all");
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
        const state = calendarStatus(item, now);
        return (
          (status === "all" ||
            (status === "active" ? !item.completed : state === status)) &&
          (clientFilter === "all" ||
            (clientFilter === "none"
              ? !item.client
              : item.client === clientFilter.slice(1))) &&
          (projectFilter === "all" ||
            (projectFilter === "none"
              ? !item.project
              : JSON.stringify([item.client, item.project]) ===
                projectFilter)) &&
          item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
          (item.repeatDaily
            ? recurringOverlaps(item, bounds.from, bounds.to)
            : calendarOverlaps(item, bounds.from, bounds.to))
        );
      });
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
            <button
              className="secondary"
              onClick={() => {
                setMonth(today.slice(0, 7));
                setAnchor(today);
              }}
            >
              Сегодня
            </button>
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
              items={items}
              anchor={anchor}
              mode={view}
              zone={zone}
              onChange={(item) =>
                mutate("/calendar/" + item.id, "PUT", {
                  title: item.title,
                  description: item.description,
                  scope: item.scope,
                  client: item.client,
                  project: item.project,
                  repeatDaily: item.repeatDaily,
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
              {days.map((day) => {
                const entries = occurrencesOnDay(items, day, zone).filter(
                  (i) =>
                    i.start &&
                    wallTime(i.start, zone).slice(0, 10) <= day &&
                    (i.end
                      ? wallTime(i.end, zone).slice(0, 10)
                      : wallTime(i.start, zone).slice(0, 10)) >= day,
                );
                return (
                  <div
                    key={day}
                    className={`calendar-day ${day.slice(0, 7) !== month ? "outside" : ""} ${day === today ? "today" : ""}`}
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
                        className={"calendar-event " + calendarStatus(i, now)}
                        onClick={() => open(i)}
                        title={
                          i.title + " · " + statusLabels[calendarStatus(i, now)]
                        }
                      >
                        <span>{wallTime(i.start!, zone).slice(11)}</span>{" "}
                        {i.title}
                      </button>
                    ))}
                    {entries.length > 3 && (
                      <button
                        className="calendar-more"
                        onClick={() => {
                          setTab("reminders");
                          setStatus("all");
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
            </div>
          )}
          <p className="muted calendar-footnote">
            Без срока: {items.filter((i) => !i.completed && !i.start).length}.
            Напоминания без даты доступны во вкладке «Напоминания».
          </p>
        </div>
      ) : (
        <>
          <div className="calendar-filters">
            <SingleSelect
              label="Состояние"
              value={status}
              onChange={setStatus}
              active={status !== "all"}
              options={Object.entries({
                all: "Все",
                active: "Все активные",
                ...statusLabels,
              }).map(([value, label]) => ({ value, label }))}
            />
            <SingleSelect
              label="Заказчик"
              value={clientFilter}
              onChange={(value) => {
                setClientFilter(value);
                setProjectFilter("all");
              }}
              active={clientFilter !== "all"}
              options={[
                { value: "all", label: "Все заказчики" },
                { value: "none", label: "Без заказчика" },
                ...[...new Set(items.map((i) => i.client).filter(Boolean))]
                  .sort()
                  .map((name) => ({ value: "=" + name, label: name })),
              ]}
            />
            <SingleSelect
              label="Проект"
              value={projectFilter}
              onChange={setProjectFilter}
              active={projectFilter !== "all"}
              options={[
                { value: "all", label: "Все проекты" },
                { value: "none", label: "Без проекта" },
                ...Array.from(
                  new Map(
                    items
                      .filter(
                        (i) =>
                          i.project &&
                          (clientFilter === "all" ||
                            clientFilter === "=" + i.client),
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
              className="secondary"
              onClick={() => {
                setClientFilter("all");
                setProjectFilter("all");
                setStatus("all");
                setQuery("");
                setFrom("");
                setTo("");
              }}
            >
              Сбросить
            </button>
          </div>
          {(from || to) && (
            <p className="muted">
              Любое пересечение с диапазоном, включая границы. Напоминания без
              даты не входят в фильтр по времени.
            </p>
          )}
          {rangeError && <p className="error">{rangeError}</p>}
          <div className="calendar-reminders">
            {filtered.map((item) => (
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
                    {statusLabels[calendarStatus(item, now)]}
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
                  {item.ticket ? "Предупреждение: " : ""}
                  {eventTime(item.start, item.end, zone)}
                  {item.ticket && (
                    <span>
                      {" "}
                      · Дедлайн: {eventTime(item.ticket.deadline, null, zone)}
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
                    {item.ticket ? "Открыть напоминание" : "Изменить"}
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
                  {item.completed && (
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
                  {!item.ticket && (
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
          disabled={!!currentItem?.ticket}
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
          <p className="muted">Дата и время в часовом поясе {zone}</p>
          <label>
            Название
            <input
              autoFocus
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="calendar-date-fields">
            <CalendarDateField
              zone={zone}
              label="Начало · необязательно"
              value={draft.start}
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
            <p className="muted">
              Одна запись, каждый день в выбранное время начиная с даты начала.
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
        <ReminderLeadFields
          value={draft.leadMinutes}
          fallback={
            currentItem?.ticket
              ? settings.calendarNotifications.ticketDeadlineLeadMinutes
              : settings.calendarNotifications.reminderLeadMinutes
          }
          onChange={(leadMinutes) => setDraft({ ...draft, leadMinutes })}
        />
        {currentItem && (
          <div className="calendar-editor-management">
            <span
              className={"calendar-state " + calendarStatus(currentItem, now)}
            >
              {statusLabels[calendarStatus(currentItem, now)]}
            </span>
            <div className="calendar-inline">
              <DailyCompletionButton item={currentItem} onChange={reload} />
              <ConfirmButton
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
              {!currentItem.ticket && (
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
              if (currentItem?.ticket) {
                await mutate(`/calendar/${currentItem.id}/warning`, "PUT", {
                  leadMinutes: draft.leadMinutes,
                });
                dialog.current?.close();
                return;
              }
              await mutate(
                "/calendar" + (editing ? "/" + editing : ""),
                editing ? "PUT" : "POST",
                {
                  leadMinutes: draft.leadMinutes,
                  repeatDaily: draft.repeatDaily,
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
