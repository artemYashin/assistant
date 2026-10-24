import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, type Store } from "./store.js";
import { fromWall } from "./calendar-time.js";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Некорректная дата отпуска.");
export const vacationInput = z
  .object({ start: date, end: date })
  .strict()
  .refine((v) => v.end >= v.start, "Окончание отпуска раньше начала.");
export function nextVacationDay(day: string) {
  return new Date(Date.parse(day + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
}
export function vacationBounds(start: string, end: string, zone: string) {
  return {
    start: fromWall(start + "T00:00", zone),
    end: new Date(
      Date.parse(fromWall(nextVacationDay(end) + "T00:00", zone)) - 1,
    ).toISOString(),
  };
}
export function setDeveloperVacation(store: Store, id: string, input: unknown) {
  const value = input === null ? null : vacationInput.parse(input);
  return store.db.transaction(() => {
    const person = store.db
      .prepare("SELECT * FROM local_developers WHERE id=? AND active=1")
      .get(id) as any;
    if (!person) throw new AppError(404, "Разработчик не найден.");
    const old = store.db
      .prepare("SELECT * FROM developer_vacations WHERE developer_id=?")
      .get(id) as any;
    if (!value) {
      if (old)
        store.db
          .prepare("DELETE FROM calendar_events WHERE id=?")
          .run(old.event_id);
      return { ok: true };
    }
    const zone = old?.zone || store.settings().syncSchedule.timeZone;
    const bounds = vacationBounds(value.start, value.end, zone);
    const eventId = old?.event_id || randomUUID();
    if (!old) {
      store.db
        .prepare(
          "INSERT INTO calendar_events(id,kind,title,description,start,end,developers,created_at) VALUES (?,'event',?,'',?,?,?,?)",
        )
        .run(
          eventId,
          "Отпуск · " + person.name,
          bounds.start,
          bounds.end,
          JSON.stringify([id]),
          new Date().toISOString(),
        );
      store.db
        .prepare(
          "INSERT INTO developer_vacations(developer_id,event_id,start_date,end_date,zone) VALUES (?,?,?,?,?)",
        )
        .run(id, eventId, value.start, value.end, zone);
    } else if (old.start_date !== value.start || old.end_date !== value.end) {
      store.db
        .prepare(
          "UPDATE developer_vacations SET start_date=?,end_date=? WHERE developer_id=?",
        )
        .run(value.start, value.end, id);
      store.db
        .prepare(
          "UPDATE calendar_events SET start=?,end=?,completed=0,last_notified=NULL WHERE id=?",
        )
        .run(bounds.start, bounds.end, eventId);
    }
    syncDeveloperVacations(store);
    return { ok: true };
  })();
}
export function syncDeveloperVacations(store: Store) {
  // Keep one event per developer; never rewrite manual notification completion or warning overrides.
  store.db
    .prepare(
      `UPDATE calendar_events SET
    title='Отпуск · '||(SELECT d.name FROM developer_vacations v JOIN local_developers d ON d.id=v.developer_id WHERE v.event_id=calendar_events.id),
    client=(SELECT d.client FROM developer_vacations v JOIN local_developers d ON d.id=v.developer_id WHERE v.event_id=calendar_events.id),
    project=(SELECT d.project FROM developer_vacations v JOIN local_developers d ON d.id=v.developer_id WHERE v.event_id=calendar_events.id),
    scope=(SELECT CASE WHEN d.project<>'' THEN 'project' WHEN d.client<>'' THEN 'client' ELSE 'general' END FROM developer_vacations v JOIN local_developers d ON d.id=v.developer_id WHERE v.event_id=calendar_events.id)
    WHERE id IN (SELECT event_id FROM developer_vacations)`,
    )
    .run();
}
