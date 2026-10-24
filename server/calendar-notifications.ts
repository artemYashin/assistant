import type { CalendarItem } from "./calendar-model.js";
import { dailyOccurrence } from "./calendar-repeat.js";
import { wallTime } from "./calendar-time.js";

/** Eligibility is shared by the header and scheduled delivery; schedule only controls delivery. */
export function notificationItems(
  items: CalendarItem[],
  defaultLeadMinutes: number,
  now = new Date(),
): CalendarItem[] {
  const instant = now.toISOString();
  return items.flatMap((item) => {
    if (item.completed) return [];
    const threshold = new Date(
      now.getTime() + (item.leadMinutes ?? defaultLeadMinutes) * 60000,
    ).toISOString();
    if (!item.repeatDaily)
      return notificationDue(item, defaultLeadMinutes, now) ? [item] : [];
    const zone = item.repeatZone || "UTC";
    const firstDay = wallTime(instant, zone).slice(0, 10);
    const lastDay = wallTime(threshold, zone).slice(0, 10);
    const result: CalendarItem[] = [];
    for (let day = firstDay; day <= lastDay;) {
      const occurrence = dailyOccurrence(item, day);
      if (occurrence && !occurrence.completed && occurrence.start! <= threshold)
        result.push(occurrence);
      day = new Date(Date.parse(day + "T12:00:00Z") + 86400000)
        .toISOString()
        .slice(0, 10);
    }
    return result;
  });
}

/** Also used to revalidate a visible occurrence after its dates/settings change. */
export function notificationDue(
  item: CalendarItem,
  defaultLeadMinutes: number,
  now = new Date(),
): boolean {
  if (item.completed) return false;
  if (!item.start) return true;
  const startsAt = item.ticket
    ? Date.parse(item.warningStart || item.ticket.deadline)
    : Date.parse(item.start) - (item.leadMinutes ?? defaultLeadMinutes) * 60000;
  return startsAt <= now.getTime();
}
