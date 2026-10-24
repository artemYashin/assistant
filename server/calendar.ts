import {
  syncDeveloperVacations,
  nextVacationDay,
} from "./developer-vacations.js";
import { notificationItems } from "./calendar-notifications.js";
import { z } from "zod";
import { dailyOccurrence } from "./calendar-repeat.js";
import { wallTime } from "./calendar-time.js";
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
    syncDeveloperVacations(this.store);
    const {
      ticketDeadlineLeadMinutes: ticketLead,
      vacationLeadMinutes: vacationLead,
    } = this.store.settings().calendarNotifications;
    return (
      this.store.db
        .prepare(
          `SELECT e.*,d.id AS ticket_id,d.source AS ticket_source,d.deadline,v.developer_id AS vacation_developer,v.start_date AS vacation_start,v.end_date AS vacation_end,v.zone AS vacation_zone FROM calendar_events e LEFT JOIN ticket_deadlines d ON d.event_id=e.id LEFT JOIN developer_vacations v ON v.event_id=e.id WHERE ${activeDeadlineSql} AND (v.developer_id IS NULL OR EXISTS (SELECT 1 FROM local_developers ld WHERE ld.id=v.developer_id AND ld.active=1)) ORDER BY COALESCE(start,created_at),e.id`,
        )
        .all() as any[]
    ).map((r) => ({
      ...(r.vacation_developer
        ? {
            vacation: {
              developerId: r.vacation_developer,
              start: r.vacation_start,
              end: r.vacation_end,
              zone: r.vacation_zone,
              returnDate: nextVacationDay(r.vacation_end),
            },
          }
        : {}),
      ...(r.ticket_id
        ? {
            ticket: {
              id: r.ticket_id,
              source: r.ticket_source,
              deadline: r.deadline,
            },
          }
        : {}),
      warningStart: r.ticket_id
        ? new Date(
            Date.parse(r.deadline) - (r.lead_minutes ?? ticketLead) * 60000,
          ).toISOString()
        : r.vacation_developer
          ? new Date(
              Date.parse(r.start) - (r.lead_minutes ?? vacationLead) * 60000,
            ).toISOString()
          : undefined,
      leadMinutes: r.lead_minutes ?? null,
      completedDays: JSON.parse(r.completed_days || "[]"),
      repeatDaily: !!r.repeat_daily,
      repeatWeekdays: JSON.parse(r.repeat_weekdays),
      repeatZone: r.repeat_zone,
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
      completed:
        !!r.completed ||
        !!(r.vacation_developer && Date.parse(r.end) < Date.now()),
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
        .prepare("SELECT 1 FROM developer_vacations WHERE event_id=?")
        .get(id)
    )
      throw new AppError(
        400,
        "Измените даты отпуска в настройках разработчика.",
      );
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
    const repeatZone =
      (id
        ? (
            this.store.db
              .prepare(
                "SELECT repeat_zone FROM calendar_events WHERE id=? AND repeat_daily=1",
              )
              .get(id) as any
          )?.repeat_zone
        : null) || this.store.settings().syncSchedule.timeZone;
    if (id) {
      const result = this.store.db
        .prepare(
          "UPDATE calendar_events SET scope=?,client=?,project=?,kind=?,title=?,description=?,start=?,end=?,developers=?,repeat_daily=?,repeat_zone=?,last_notified=NULL WHERE id=?",
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
          v.repeatDaily ? 1 : 0,
          repeatZone,
          id,
        );
      if (!result.changes) throw new AppError(404, "Напоминание не найдено.");
    } else {
      id = randomUUID();
      this.store.db
        .prepare(
          "INSERT INTO calendar_events(id,scope,client,project,kind,title,description,start,end,developers,created_at,repeat_daily,repeat_zone) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
          v.repeatDaily ? 1 : 0,
          repeatZone,
        );
    }
    this.store.db
      .prepare("UPDATE calendar_events SET repeat_weekdays=? WHERE id=?")
      .run(
        JSON.stringify(
          [...new Set(v.repeatWeekdays ?? [1, 2, 3, 4, 5, 6, 7])].sort(),
        ),
        id,
      );
    this.setLead(id!, v.leadMinutes ?? null);
    return { id };
  }
  setLead(id: string, lead: unknown) {
    const minutes = z.number().int().min(0).max(525600).nullable().parse(lead);
    if (
      !this.store.db
        .prepare("UPDATE calendar_events SET lead_minutes=? WHERE id=?")
        .run(minutes, id).changes
    )
      throw new AppError(404, "Напоминание не найдено.");
    syncTicketDeadlines(this.store);
    return { ok: true };
  }
  completeToday(
    id: string,
    completed = true,
    now = new Date(),
    occurrenceDay?: string,
  ) {
    return this.store.db.transaction(() => {
      const item = this.list().find((i) => i.id === id);
      if (!item) throw new AppError(404, "Напоминание не найдено.");
      const day =
        occurrenceDay ??
        wallTime(now.toISOString(), item.repeatZone || "UTC").slice(0, 10);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(Date.parse(day)) ||
        new Date(day).toISOString().slice(0, 10) !== day
      )
        throw new AppError(400, "Некорректная дата итерации.");
      if (!item.repeatDaily || !dailyOccurrence(item, day))
        throw new AppError(
          400,
          "У напоминания нет итерации за выбранную дату.",
        );
      const days = new Set(item.completedDays || []);
      if (completed) days.add(day);
      else days.delete(day);
      this.store.db
        .prepare(
          "UPDATE calendar_events SET completed_days=?,last_notified=CASE WHEN ?=0 THEN NULL ELSE last_notified END WHERE id=?",
        )
        .run(JSON.stringify([...days].sort()), completed ? 1 : 0, id);
      return { ok: true, day, completed };
    })();
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
    const vacation = this.store.db
      .prepare(
        "SELECT e.end FROM developer_vacations v JOIN calendar_events e ON e.id=v.event_id WHERE e.id=?",
      )
      .get(id) as { end: string } | undefined;
    if (vacation && Date.parse(vacation.end) < Date.now())
      throw new AppError(
        400,
        "Отпуск уже закончился. Новый период задайте в настройках разработчика.",
      );
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
      this.store.db
        .prepare("SELECT 1 FROM developer_vacations WHERE event_id=?")
        .get(id)
    ) {
      this.complete(id);
      return { ok: true, completed: true };
    }
    if (
      this.store.db
        .prepare("SELECT 1 FROM ticket_deadlines WHERE event_id=?")
        .get(id)
    ) {
      this.complete(id);
      return { ok: true, completed: true };
    }
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
    const cutoff = now.getTime() - options.intervalMinutes * 60000;
    return this.store.db.transaction(() => {
      // One persisted batch clock for every project, reminder and browser tab.
      const batchKey = "calendar.notifications.last-batch-at";
      const lastBatch = this.store.get<number | null>(batchKey, null);
      if (lastBatch !== null && lastBatch > cutoff) return [];
      const due = notificationItems(
        this.list(),
        options.reminderLeadMinutes,
        now,
      );
      // An empty collection sends nothing and does not postpone a future batch.
      if (due.length) this.store.set(batchKey, now.getTime());
      return due;
    })();
  }
}
