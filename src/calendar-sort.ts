import type { CalendarItem } from "../server/calendar-model.js";
import { dailyOccurrence } from "../server/calendar-repeat.js";
import { wallTime } from "../server/calendar-time.js";
export function reminderDate(item: CalendarItem, now: string): number | null {
  if (item.ticket) return Date.parse(item.ticket.deadline);
  if (!item.start) return null;
  if (!item.repeatDaily || item.completed) return Date.parse(item.start);
  let day = wallTime(now, item.repeatZone || "UTC").slice(0, 10);
  const first = wallTime(item.start, item.repeatZone || "UTC").slice(0, 10);
  if (day < first) day = first;
  for (let n = 0; n <= ((item.completedDays?.length || 0) + 1) * 7 + 3; n++) {
    const occurrence = dailyOccurrence(item, day);
    if (
      occurrence &&
      !occurrence.completed &&
      Date.parse(occurrence.start!) >= Date.parse(now)
    )
      return Date.parse(occurrence.start!);
    day = new Date(Date.parse(day + "T12:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
  }
  return Date.parse(item.start);
}
export function sortReminders(
  items: CalendarItem[],
  mode: string,
  now: string,
) {
  const dates = new Map(
    items.map((item) => [item.id, reminderDate(item, now)]),
  );
  const instant = Date.parse(now);
  return [...items].sort((a, b) => {
    if (mode === "title")
      return a.title.localeCompare(b.title, "ru") || a.id.localeCompare(b.id);
    const x = dates.get(a.id)!,
      y = dates.get(b.id)!;
    if (mode === "nearest") {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const group = (date: number | null) =>
        date === null ? 2 : date >= instant ? 0 : 1;
      if (group(x) !== group(y)) return group(x) - group(y);
    }
    if (x === null || y === null)
      return x === y ? a.id.localeCompare(b.id) : x === null ? 1 : -1;
    const direction =
      mode === "desc" || (mode === "nearest" && x < instant && y < instant)
        ? -1
        : 1;
    return direction * (x - y) || a.id.localeCompare(b.id);
  });
}
