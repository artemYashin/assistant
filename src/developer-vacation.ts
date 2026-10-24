import { wallTime } from "./calendar-time.js";
export function nextVacationDay(day: string) {
  return new Date(Date.parse(day + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
}
export function developerOnVacation(
  person: {
    vacationStart?: string | null;
    vacationEnd?: string | null;
    vacationZone?: string | null;
  },
  now: string,
) {
  if (!person.vacationStart || !person.vacationEnd) return false;
  const day = wallTime(now, person.vacationZone || "UTC").slice(0, 10);
  return day >= person.vacationStart && day <= person.vacationEnd;
}
