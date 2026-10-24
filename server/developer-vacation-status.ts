import { fromWall, wallTime } from "./calendar-time.js";

type VacationDates = {
  vacationStart?: string | null;
  vacationEnd?: string | null;
  vacationZone?: string | null;
};
export function nextVacationDay(day: string) {
  return new Date(Date.parse(day + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
}
export function developerVacationStatus(person: VacationDates, now: string) {
  if (!person.vacationStart || !person.vacationEnd) return "none";
  const day = wallTime(now, person.vacationZone || "UTC").slice(0, 10);
  if (day < person.vacationStart) return "upcoming";
  if (day > person.vacationEnd) return "past";
  return "current";
}
export function developerOnVacation(person: VacationDates, now: string) {
  return developerVacationStatus(person, now) === "current";
}


// The assignment warning follows the global vacation lead, independently of
// per-event notification visibility or individual calendar warning overrides.
export function developerVacationWarningStart(person: VacationDates, leadMinutes: number) {
  if (!person.vacationStart || !person.vacationEnd) return null;
  const start = fromWall(person.vacationStart + "T00:00", person.vacationZone || "UTC");
  return new Date(Date.parse(start) - leadMinutes * 60000).toISOString();
}
