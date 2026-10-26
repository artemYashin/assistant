import type { CalendarItem } from "./calendar-model.js";
import { fromWall, wallTime } from "./calendar-time.js";

/** Virtual occurrences retain the series ID; never persisted as separate rows. */
export function dailyOccurrence(item: CalendarItem, day: string): CalendarItem | null {
  if (!item.start) return null;
  const zone = item.repeatZone || "UTC";
  const first = wallTime(item.start, zone);
  if (day < first.slice(0, 10)) return null;
  const weekday = new Date(day + "T12:00:00Z").getUTCDay() || 7;
  if (item.repeatWeekdays && !item.repeatWeekdays.includes(weekday)) return null;
  const completed = item.completed || !!item.completedDays?.includes(day);
  if (day === first.slice(0, 10)) return { ...item, completed, occurrenceDay: day };
  try {
    const start = new Date(
      Date.parse(fromWall(day + first.slice(10), zone)) + (Date.parse(item.start) % 60000),
    ).toISOString();
    return {
      ...item,
      completed,
      occurrenceDay: day,
      start,
      end: item.end
        ? new Date(Date.parse(start) + Date.parse(item.end) - Date.parse(item.start)).toISOString()
        : null,
    };
  } catch {
    return null;
  } // Nonexistent wall time at DST: skip this day.
}
export function occurrencesOnDay(items: CalendarItem[], day: string, zone: string) {
  return items.flatMap((item) => {
    if (!item.repeatDaily) return [item];
    const result: CalendarItem[] = [];
    for (const offset of [-2, -1, 0, 1, 2]) {
      const d = new Date(day + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + offset);
      const occurrence = dailyOccurrence(item, d.toISOString().slice(0, 10));
      if (
        occurrence &&
        wallTime(occurrence.start!, zone).slice(0, 10) <= day &&
        wallTime(occurrence.end || occurrence.start!, zone).slice(0, 10) >= day
      )
        result.push(occurrence);
    }
    return result;
  });
}
export function recurringOverlaps(item: CalendarItem, from?: string, to?: string) {
  if (!item.start || (to && Date.parse(to) < Date.parse(item.start))) return false;
  if (!to) return true;
  const lower = from && Date.parse(from) > Date.parse(item.start) ? from : item.start;
  if (Date.parse(to) - Date.parse(lower) >= 16 * 86400000) return true;
  const day = wallTime(lower, item.repeatZone || "UTC").slice(0, 10);
  for (let n = -1; n <= 17; n++) {
    const d = new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    const o = dailyOccurrence(item, d.toISOString().slice(0, 10));
    if (
      o &&
      Date.parse(o.start!) <= Date.parse(to) &&
      (!from || Date.parse(o.end || o.start!) >= Date.parse(from))
    )
      return true;
  }
  return false;
}
