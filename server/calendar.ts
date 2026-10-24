import { syncTicketDeadlines, activeDeadlineSql } from "./ticket-deadlines.js";
import { calendarInput, type CalendarItem } from "./calendar-model.js";
import { randomUUID } from "node:crypto";
import type { Store } from "./store.js";
import { AppError } from "./store.js";
import { syncAllowed } from "./sync-schedule.js";

export class Calendar {
  constructor(private store: Store) {}
  list(): CalendarItem[] {
    syncTicketDeadlines(this.store);
    return (
      this.store.db
        .prepare(
          `SELECT e.*,d.id AS ticket_id,d.source AS ticket_source,d.deadline FROM calendar_events e LEFT JOIN ticket_deadlines d ON d.event_id=e.id WHERE ${activeDeadlineSql} ORDER BY COALESCE(start,created_at),e.id`,
        )
        .all() as any[]
    ).map((r) => ({
      ...(r.ticket_id
        ? {
            ticket: {
              id: r.ticket_id,
              source: r.ticket_source,
              deadline: r.deadline,
            },
          }
        : {}),
      id: r.id,
      kind: !r.start ? "general" : r.end ? "event" : "reminder",
      scope: r.scope,
      client: r.client,
      project: r.project,
      title: r.title,
      description: r.description,
      start: r.start,
      end: r.end,
      developerIds: JSON.parse(r.developers),
      completed: !!r.completed,
      createdAt: r.created_at,
    }));
  }
  developers() {
    return this.store.db
      .prepare(
        "SELECT id,name,client,project FROM local_developers WHERE active=1 ORDER BY name,id",
      )
      .all();
  }
  save(input: unknown, id?: string) {
    if (
      id &&
      this.store.db
        .prepare("SELECT 1 FROM ticket_deadlines WHERE event_id=?")
        .get(id)
    )
      throw new AppError(400, "Измените локальный дедлайн в карточке тикета.");
    const v = calendarInput.parse(input),
      ids = [...new Set(v.developerIds)];
    if (
      v.scope !== "general" &&
      !this.store
        .contexts()
        .some(
          (c) =>
            c.client === v.client &&
            (v.scope === "client" || c.project === v.project),
        )
    )
      throw new AppError(400, "Заказчик или проект не найден.");
    if (v.start) v.start = new Date(v.start).toISOString();
    if (v.end) v.end = new Date(v.end).toISOString();
    for (const developer of ids)
      if (
        !this.store.db
          .prepare("SELECT 1 FROM local_developers WHERE id=? AND active=1")
          .get(developer)
      )
        throw new AppError(400, "Выбранный разработчик больше недоступен.");
    if (id) {
      const result = this.store.db
        .prepare(
          "UPDATE calendar_events SET scope=?,client=?,project=?,kind=?,title=?,description=?,start=?,end=?,developers=?,last_notified=NULL WHERE id=?",
        )
        .run(
          v.scope,
          v.client,
          v.project,
          v.kind,
          v.title,
          v.description,
          v.start,
          v.end,
          JSON.stringify(ids),
          id,
        );
      if (!result.changes) throw new AppError(404, "Напоминание не найдено.");
    } else {
      id = randomUUID();
      this.store.db
        .prepare(
          "INSERT INTO calendar_events(id,scope,client,project,kind,title,description,start,end,developers,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          v.scope,
          v.client,
          v.project,
          v.kind,
          v.title,
          v.description,
          v.start,
          v.end,
          JSON.stringify(ids),
          new Date().toISOString(),
        );
    }
    return { id };
  }
  complete(id: string) {
    if (
      !this.store.db
        .prepare("UPDATE calendar_events SET completed=1 WHERE id=?")
        .run(id).changes
    )
      throw new AppError(404, "Напоминание не найдено.");
    return { ok: true };
  }
  reopen(id: string) {
    if (
      !this.store.db
        .prepare(
          "UPDATE calendar_events SET completed=0,last_notified=NULL WHERE id=?",
        )
        .run(id).changes
    )
      throw new AppError(404, "Напоминание не найдено.");
    return { ok: true };
  }
  remove(id: string) {
    if (
      !this.store.db.prepare("DELETE FROM calendar_events WHERE id=?").run(id)
        .changes
    )
      throw new AppError(404, "Напоминание не найдено.");
    return { ok: true };
  }
  notifications(now = new Date()) {
    syncTicketDeadlines(this.store);
    const settings = this.store.settings(),
      options = settings.calendarNotifications;
    if (
      !syncAllowed(
        { ...options.schedule, timeZone: settings.syncSchedule.timeZone },
        now,
      )
    )
      return [];
    const instant = now.toISOString(),
      cutoff = now.getTime() - options.intervalMinutes * 60000;
    return this.store.db.transaction(() => {
      const ids = (
        this.store.db
          .prepare(
            `SELECT e.id FROM calendar_events e LEFT JOIN ticket_deadlines d ON d.event_id=e.id WHERE ${activeDeadlineSql} AND completed=0 AND (start IS NULL OR start<=?) AND (last_notified IS NULL OR last_notified<=?) ORDER BY start,e.id LIMIT 20`,
          )
          .all(instant, cutoff) as { id: string }[]
      ).map((r) => r.id);
      for (const id of ids)
        this.store.db
          .prepare("UPDATE calendar_events SET last_notified=? WHERE id=?")
          .run(now.getTime(), id);
      return this.list().filter((item) => ids.includes(item.id));
    })();
  }
}
