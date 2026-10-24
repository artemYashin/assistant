import { useEffect, useRef } from "react";
import type { CalendarItem } from "../server/calendar-model.js";
import { calendarStatus } from "../server/calendar-model.js";
import { calendarSegments, calendarWeekDays } from "./calendar-layout.js";
import { eventTime, wallTime } from "./calendar-time.js";
export function CalendarTimeGrid({
  items,
  anchor,
  mode,
  zone,
  onOpen,
  onCreate,
}: {
  items: CalendarItem[];
  anchor: string;
  mode: string;
  zone: string;
  onOpen: (item: CalendarItem) => void;
  onCreate: (time: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    days = calendarWeekDays(anchor, mode);
  const today = wallTime(new Date().toISOString(), zone);
  useEffect(() => {
    if (root.current) root.current.scrollTop = 8 * 52;
  }, [anchor, mode]);
  return (
    <div
      className="calendar-time-scroll"
      ref={root}
      aria-label="Календарь по времени"
    >
      <div
        className={`calendar-time-grid ${mode}`}
        style={{
          gridTemplateColumns: `54px repeat(${days.length},minmax(0,1fr))`,
        }}
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
            <span key={hour} style={{ top: hour * 52 }}>
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
            {calendarSegments(items, day, zone).map(
              ({ item, top, bottom, lane, lanes }) => (
                <button
                  key={item.id}
                  className={`calendar-time-event ${calendarStatus(item)}`}
                  title={`${item.title}\n${eventTime(item.start, item.end, zone)}`}
                  style={{
                    top: (top / 60) * 52,
                    height: Math.max(20, ((bottom - top) / 60) * 52 - 2),
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                  }}
                  onClick={() => onOpen(item)}
                >
                  <small>
                    {wallTime(item.start!, zone).slice(11)}
                    {item.end ? "–" + wallTime(item.end, zone).slice(11) : ""}
                  </small>
                  <strong>{item.title}</strong>
                </button>
              ),
            )}
            {today.startsWith(day) && (
              <div
                className="calendar-now"
                style={{
                  top:
                    (Number(today.slice(11, 13)) +
                      Number(today.slice(14, 16)) / 60) *
                    52,
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
