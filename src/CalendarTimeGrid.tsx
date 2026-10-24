import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
} from "react";
import type { CalendarItem } from "../server/calendar-model.js";
import { calendarStatus } from "../server/calendar-model.js";
import {
  calendarSegments,
  calendarWeekDays,
  shiftCalendarItem,
} from "./calendar-layout.js";
import { eventTime, wallTime } from "./calendar-time.js";
const HOUR_HEIGHT = 120;

export function CalendarTimeGrid({
  items,
  anchor,
  mode,
  zone,
  onOpen,
  onCreate,
  onChange,
}: {
  items: CalendarItem[];
  anchor: string;
  mode: string;
  zone: string;
  onOpen: (item: CalendarItem) => void;
  onCreate: (time: string) => void;
  onChange: (item: CalendarItem) => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null),
    days = calendarWeekDays(anchor, mode);
  const [preview, setPreview] = useState<CalendarItem | null>(null);
  const [pending, setPending] = useState<{
    before: CalendarItem;
    after: CalendarItem;
    resize: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmation = useRef<HTMLDialogElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => {
    if (pending) confirmation.current?.showModal();
  }, [pending]);
  function begin(event: ReactPointerEvent, item: CalendarItem, day: string) {
    if (event.button !== 0 || pending || item.ticket || item.repeatDaily) return;
    const resize =
      (event.target as HTMLElement).closest(".calendar-resize") !== null;
    const scroller = root.current!;
    const columns = [
      ...scroller.querySelectorAll<HTMLElement>(".calendar-time-day"),
    ];
    const origin = days.indexOf(day),
      x = event.clientX,
      y = event.clientY,
      scroll = scroller.scrollTop;
    let moved = false,
      candidate: CalendarItem | null = null,
      lastY = y,
      lastX = x;
    setError("");
    function update() {
      let target = columns.findIndex((el) => {
        const r = el.getBoundingClientRect();
        return lastX >= r.left && lastX < r.right;
      });
      if (target < 0)
        target =
          lastX < columns[0].getBoundingClientRect().left
            ? 0
            : columns.length - 1;
      const delta =
        (target - origin) * 1440 +
        Math.round(
          (((lastY - y + scroller.scrollTop - scroll) / HOUR_HEIGHT) * 60) / 15,
        ) *
          15;
      try {
        candidate = shiftCalendarItem(item, delta, resize, zone);
        setPreview(candidate);
        setError("");
      } catch (e) {
        candidate = null;
        setPreview(null);
        setError((e as Error).message);
      }
    }
    function move(e: PointerEvent) {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!moved && Math.hypot(lastX - x, lastY - y) < 5) return;
      moved = true;
      e.preventDefault();
      update();
    }
    const timer = window.setInterval(() => {
      if (!moved) return;
      const r = scroller.getBoundingClientRect();
      const delta = lastY < r.top + 45 ? -10 : lastY > r.bottom - 35 ? 10 : 0;
      if (delta) {
        scroller.scrollTop += delta;
        update();
      }
    }, 40);
    function clear() {
      window.clearInterval(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      cleanup.current = null;
    }
    function cancel() {
      clear();
      setPreview(null);
      suppressClick.current = moved;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    }
    function finish() {
      clear();
      setPreview(null);
      suppressClick.current = moved;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      if (
        moved &&
        candidate &&
        (candidate.start !== item.start || candidate.end !== item.end)
      )
        setPending({ before: item, after: candidate, resize });
    }
    cleanup.current = clear;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
  }
  const today = wallTime(new Date().toISOString(), zone);
  useEffect(() => {
    const scroller = root.current;
    if (!scroller) return;
    const now = wallTime(new Date().toISOString(), zone);
    const hours = Number(now.slice(11, 13)) + Number(now.slice(14, 16)) / 60;
    const headerHeight =
      scroller.querySelector(".calendar-time-corner")?.getBoundingClientRect()
        .height ?? 0;
    scroller.scrollTop = Math.max(
      0,
      hours * HOUR_HEIGHT - (scroller.clientHeight - headerHeight) / 2,
    );
  }, [anchor, mode, zone]);
  return (
    <>
      {error && !pending && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div
        className="calendar-time-scroll"
        ref={root}
        aria-label="Календарь по времени"
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        <div
          className={`calendar-time-grid ${mode}`}
          style={{
            gridTemplateColumns: `54px repeat(${days.length},minmax(0,1fr))`,
            "--calendar-hour-height": `${HOUR_HEIGHT}px`,
          } as CSSProperties}
        >
          <div className="calendar-time-corner">{zone.split("/").at(-1)}</div>
          {days.map((day) => (
            <div
              key={day}
              className={`calendar-time-heading ${today.startsWith(day) ? "today" : ""}`}
            >
              <span>
                {new Intl.DateTimeFormat("ru-RU", {
                  weekday: "short",
                  timeZone: "UTC",
                }).format(new Date(day + "T12:00Z"))}
              </span>
              <strong>{Number(day.slice(-2))}</strong>
            </div>
          ))}
          <div className="calendar-hours">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div className="calendar-time-day" key={day}>
              {Array.from({ length: 24 }, (_, hour) => (
                <button
                  key={hour}
                  className="calendar-time-slot"
                  aria-label={`Создать ${day} в ${hour}:00`}
                  onClick={() =>
                    onCreate(`${day}T${String(hour).padStart(2, "0")}:00`)
                  }
                />
              ))}
              {calendarSegments(
                preview
                  ? items.map((i) => (i.id === preview.id ? preview : i))
                  : items,
                day,
                zone,
              ).map(({ item, top, bottom, lane, lanes }) => (
                <button
                  key={item.id+":"+item.start}
                  className={`calendar-time-event ${calendarStatus(item)}`}
                  title={`${item.title}\n${eventTime(item.start, item.end, zone)}`}
                  style={{
                    top: (top / 60) * HOUR_HEIGHT,
                    height: Math.max(20, ((bottom - top) / 60) * HOUR_HEIGHT - 2),
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                  }}
                  onPointerDown={(event) => {
                    suppressClick.current = false;
                    begin(event, item, day);
                  }}
                  onClick={() => {
                    if (!suppressClick.current) onOpen(item);
                    suppressClick.current = false;
                  }}
                >
                  <strong>{item.ticket ? item.title.replace(/^Дедлайн /, "") : item.title}</strong>
                  <small>
                    {item.ticket
                      ? "Дедлайн: " + eventTime(item.ticket.deadline, null, zone)
                      : wallTime(item.start!, zone).slice(11) +
                        (item.end ? "–" + wallTime(item.end, zone).slice(11) : "")}
                  </small>
                  {!item.repeatDaily && !item.ticket && (!item.end ||
                    wallTime(
                      new Date(Date.parse(item.end) - 1).toISOString(),
                      zone,
                    ).slice(0, 10) === day) && (
                    <span
                      className="calendar-resize"
                      title="Потяните для изменения длительности"
                      aria-hidden="true"
                    />
                  )}
                </button>
              ))}
              {today.startsWith(day) && (
                <div
                  className="calendar-now"
                  style={{
                    top:
                      (Number(today.slice(11, 13)) +
                        Number(today.slice(14, 16)) / 60) *
                      HOUR_HEIGHT,
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <dialog
        ref={confirmation}
        className="developer-dialog action-confirm-dialog"
        aria-label="Изменить время события"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
        onClose={() => {
          setPending(null);
          setError("");
        }}
      >
        <h2>
          {pending?.resize ? "Изменить длительность?" : "Перенести событие?"}
        </h2>
        <p>{pending?.before.title}</p>
        <p>
          Было:{" "}
          {pending && eventTime(pending.before.start, pending.before.end, zone)}
        </p>
        <p>
          Будет:{" "}
          {pending && eventTime(pending.after.start, pending.after.end, zone)}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="secondary"
            autoFocus
            disabled={busy}
            onClick={() => confirmation.current?.close()}
          >
            Отмена
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              if (!pending || busy) return;
              setBusy(true);
              setError("");
              try {
                await onChange(pending.after);
                confirmation.current?.close();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Сохраняю…" : "Подтвердить"}
          </button>
        </div>
      </dialog>
    </>
  );
}
