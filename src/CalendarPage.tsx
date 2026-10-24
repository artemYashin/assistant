import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
  Check,
  Trash2,
  Pencil,
  X,
  Clock,
  Users,
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
  open: "Без срока",
  upcoming: "Предстоит",
  ongoing: "Идёт сейчас",
  overdue: "Просрочено",
  completed: "Завершено",
};
export const calendarChanged = () =>
  window.dispatchEvent(new Event("orbit-calendar-changed"));
type Developer = { id: string; name: string; client: string; project: string };
const fresh = (day: string) => ({
  title: "",
  description: "",
  kind: "reminder" as CalendarItem["kind"],
  start: day + "T09:00",
  end: "",
  developerIds: [] as string[],
});
export function CalendarPage({ settings }: { settings: any }) {
  const zone = settings?.syncSchedule?.timeZone || "UTC";
  const today = wallTime(new Date().toISOString(), zone).slice(0, 10);
  const [month, setMonth] = useState(today.slice(0, 7)),
    [tab, setTab] = useState("calendar");
  const [items, setItems] = useState<CalendarItem[]>([]),
    [developers, setDevelopers] = useState<Developer[]>([]);
  const [error, setError] = useState(""),
    [status, setStatus] = useState("active"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [query, setQuery] = useState("");
  const [draft, setDraft] = useState(fresh(today)),
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
  function open(item?: CalendarItem, day = today) {
    setEditing(item?.id || null);
    setDraft(
      item
        ? {
            ...item,
            start: item.start ? wallTime(item.start, zone) : "",
            end: item.end ? wallTime(item.end, zone) : "",
          }
        : fresh(day),
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
          item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
          calendarOverlaps(item, bounds.from, bounds.to)
        );
      });
  const base = new Date(month + "-01T12:00:00Z");
  const offset = (base.getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(1 - offset + i);
    return d.toISOString().slice(0, 10);
  });
  function shift(n: number) {
    const d = new Date(base);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  }
  async function mutate(path: string, method: string, body?: unknown) {
    await api(path, method, body);
    await reload();
    calendarChanged();
  }
  const validDraft =
    !!draft.title.trim() &&
    (draft.kind === "general" || !!draft.start) &&
    (!draft.end || draft.end >= draft.start);
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
                aria-label="Предыдущий месяц"
                onClick={() => shift(-1)}
              >
                <ChevronLeft size={18} />
              </button>
              <h2>
                {new Intl.DateTimeFormat("ru-RU", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(base)}
              </h2>
              <button
                className="icon-button"
                aria-label="Следующий месяц"
                onClick={() => shift(1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <button
              className="secondary"
              onClick={() => setMonth(today.slice(0, 7))}
            >
              Сегодня
            </button>
          </div>
          <div className="calendar-grid">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
              <div className="calendar-weekday" key={d}>
                {d}
              </div>
            ))}
            {days.map((day) => {
              const entries = items.filter(
                (i) =>
                  i.start &&
                  !i.completed &&
                  wallTime(i.start, zone).slice(0, 10) <= day &&
                  (i.end
                    ? wallTime(i.end, zone).slice(0, 10)
                    : i.kind === "event"
                      ? "9999"
                      : wallTime(i.start, zone).slice(0, 10)) >= day,
              );
              return (
                <div
                  key={day}
                  className={`calendar-day ${day.slice(0, 7) !== month ? "outside" : ""} ${day === today ? "today" : ""}`}
                >
                  <button
                    className="calendar-day-number"
                    title="Создать напоминание"
                    onClick={() => open(undefined, day)}
                  >
                    {Number(day.slice(-2))}
                    <Plus size={12} />
                  </button>
                  {entries.slice(0, 3).map((i) => (
                    <button
                      key={i.id}
                      className={"calendar-event " + calendarStatus(i, now)}
                      onClick={() => open(i)}
                      title={i.title}
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
                        setStatus("active");
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
          <p className="muted calendar-footnote">
            Без срока: {items.filter((i) => !i.completed && !i.start).length}.
            Общие напоминания доступны во вкладке «Напоминания».
          </p>
        </div>
      ) : (
        <>
          <div className="calendar-filters">
            <label>
              Состояние
              <select
                aria-label="Состояние"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {Object.entries({
                  active: "Все активные",
                  ...statusLabels,
                  all: "Все, включая завершённые",
                }).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Поиск
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Название напоминания"
              />
            </label>
            <label>
              С
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              По
              <input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <button
              className="secondary"
              onClick={() => {
                setStatus("active");
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
                <p className="calendar-inline muted">
                  <Clock size={15} />
                  {eventTime(item.start, item.end, zone)}
                  {item.kind === "event" && !item.end ? " · Без окончания" : ""}
                </p>
                {item.description && (
                  <p className="calendar-description">{item.description}</p>
                )}
                {!!item.developerIds.length && (
                  <p className="calendar-inline">
                    <Users size={15} />
                    {item.developerIds
                      .map(
                        (id) =>
                          developers.find((d) => d.id === id)?.name ||
                          "Удалённый разработчик",
                      )
                      .join(", ")}
                  </p>
                )}
                <div className="calendar-inline">
                  <button className="secondary" onClick={() => open(item)}>
                    <Pencil size={15} />
                    Изменить
                  </button>
                  {!item.completed && (
                    <ConfirmButton
                      title="Завершить напоминание?"
                      message={`«${item.title}» останется в истории, уведомления прекратятся.`}
                      confirmLabel="Завершить"
                      onConfirm={() =>
                        mutate("/calendar/" + item.id + "/complete", "POST", {})
                      }
                    >
                      <Check size={15} />
                      Завершить
                    </ConfirmButton>
                  )}
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
        <label>
          Тип
          <select
            aria-label="Тип"
            value={draft.kind}
            onChange={(e) =>
              setDraft({
                ...draft,
                kind: e.target.value as CalendarItem["kind"],
                end: "",
              })
            }
          >
            <option value="reminder">Напоминание на дату и время</option>
            <option value="event">Событие с длительностью</option>
            <option value="general">Общее напоминание без срока</option>
          </select>
        </label>
        {draft.kind !== "general" && (
          <div className="calendar-date-fields">
            <label>
              Начало
              <input
                type="datetime-local"
                value={draft.start}
                onChange={(e) => setDraft({ ...draft, start: e.target.value })}
              />
            </label>
            {draft.kind === "event" && (
              <label>
                Окончание · необязательно
                <input
                  type="datetime-local"
                  min={draft.start}
                  value={draft.end}
                  onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                />
              </label>
            )}
          </div>
        )}
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
        <div className="dialog-actions">
          <button className="secondary" onClick={() => dialog.current?.close()}>
            Отмена
          </button>
          <ConfirmButton
            disabled={!validDraft}
            className="primary"
            title={editing ? "Сохранить изменения?" : "Создать напоминание?"}
            message={`«${draft.title}» · ${draft.kind === "general" ? "Без срока" : draft.start.replace("T", " ") + " · " + zone}`}
            confirmLabel={editing ? "Сохранить" : "Создать"}
            onConfirm={async () => {
              await mutate(
                "/calendar" + (editing ? "/" + editing : ""),
                editing ? "PUT" : "POST",
                {
                  title: draft.title,
                  description: draft.description,
                  kind: draft.kind,
                  start:
                    draft.kind === "general"
                      ? null
                      : fromWall(draft.start, zone),
                  end:
                    draft.kind === "event" && draft.end
                      ? fromWall(draft.end, zone)
                      : null,
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
