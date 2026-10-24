import { occurrencesOnDay } from "../server/calendar-repeat.js";
import type { CalendarItem } from "../server/calendar-model.js";
import { fromWall, wallTime } from "./calendar-time.js";
export function calendarWeekDays(anchor: string, mode: string) {
  const date = new Date(anchor + "T12:00:00Z");
  if (mode === "week")
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return Array.from({ length: mode === "week" ? 7 : 1 }, (_, i) => {
    const day = new Date(date);
    day.setUTCDate(day.getUTCDate() + i);
    return day.toISOString().slice(0, 10);
  });
}
export function calendarSegments(
  items: CalendarItem[],
  day: string,
  zone: string,
) {
  const minutes = (value: string) =>
    Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
  const segments = occurrencesOnDay(items, day, zone)
    .filter((i) => i.start)
    .flatMap((item) => {
      const start = wallTime(item.start!, zone),
        end = item.end ? wallTime(item.end, zone) : start;
      if (start.slice(0, 10) > day || end.slice(0, 10) < day) return [];
      const top = start.slice(0, 10) < day ? 0 : minutes(start);
      let bottom = end.slice(0, 10) > day ? 1440 : minutes(end);
      if (bottom === 0 && end.slice(0, 10) === day && start.slice(0, 10) < day)
        return [];
      // Only point reminders need a visual hit area; explicit durations stay exact.
      if (!item.end || bottom <= top) bottom = Math.min(1440, top + 30);
      return [{ item, top, bottom, lane: 0, lanes: 1 }];
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let group: typeof segments = [],
    until = -1;
  const finish = () => {
    const lanes = Math.max(1, ...group.map((s) => s.lane + 1));
    group.forEach((s) => (s.lanes = lanes));
  };
  for (const segment of segments) {
    if (segment.top >= until) {
      finish();
      group = [];
      until = -1;
    }
    const occupied = new Set(
      group.filter((s) => s.bottom > segment.top).map((s) => s.lane),
    );
    while (occupied.has(segment.lane)) segment.lane++;
    group.push(segment);
    until = Math.max(until, segment.bottom);
  }
  finish();
  return segments;
}

// Shift wall-clock time in the configured zone; keep actual duration on moves.
export function shiftCalendarItem(
  item: CalendarItem,
  minutes: number,
  resize: boolean,
  zone: string,
): CalendarItem {
  if (!item.start) throw new Error("У напоминания нет времени начала");
  const base = resize
    ? item.end || new Date(Date.parse(item.start) + 30 * 60000).toISOString()
    : item.start;
  const wall = new Date(wallTime(base, zone) + ":00Z");
  wall.setUTCMinutes(wall.getUTCMinutes() + minutes);
  const shifted = fromWall(wall.toISOString().slice(0, 16), zone);
  if (resize) {
    const end = new Date(
      Math.max(Date.parse(shifted), Date.parse(item.start) + 15 * 60000),
    ).toISOString();
    return { ...item, end, kind: "event" };
  }
  return {
    ...item,
    start: shifted,
    end: item.end
      ? new Date(
          Date.parse(shifted) + Date.parse(item.end) - Date.parse(item.start),
        ).toISOString()
      : null,
  };
}
