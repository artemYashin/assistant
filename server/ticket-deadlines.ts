import { randomUUID } from "node:crypto";
import type { Store } from "./store.js";

export function setTicketDeadline(
  store: Store,
  id: number,
  source: string,
  deadline: string | null,
) {
  store.db.transaction(() => {
    const old = store.db
      .prepare("SELECT * FROM ticket_deadlines WHERE source=? AND id=?")
      .get(source, id) as any;
    if (old?.deadline === deadline) return;
    if (!deadline) {
      if (old)
        store.db
          .prepare("DELETE FROM calendar_events WHERE id=?")
          .run(old.event_id);
      return;
    }
    const eventId = old?.event_id || randomUUID();
    store.db
      .prepare(
        "INSERT INTO calendar_events(id,kind,title,description,start,end,developers,created_at) VALUES (?,'reminder',?,'',?,NULL,'[]',?) ON CONFLICT(id) DO UPDATE SET completed=0,last_notified=NULL",
      )
      .run(
        eventId,
        `Дедлайн тикета #${id}`,
        deadline,
        new Date().toISOString(),
      );
    store.db
      .prepare(
        "INSERT INTO ticket_deadlines(source,id,deadline,event_id) VALUES (?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET deadline=excluded.deadline",
      )
      .run(source, id, deadline, eventId);
    syncTicketDeadlines(store);
  })();
}
export function syncTicketDeadlines(store: Store) {
  const lead =
    store.settings().calendarNotifications.ticketDeadlineLeadMinutes * 60000;
  const rows = store.db
    .prepare(
      "SELECT d.*,t.title,e.lead_minutes,e.title AS saved_title,e.start AS saved_start,e.developers AS saved_developers FROM ticket_deadlines d JOIN calendar_events e ON e.id=d.event_id LEFT JOIN tickets t ON t.source=d.source AND t.id=d.id",
    )
    .all() as any[];
  const update = store.db.prepare(
    "UPDATE calendar_events SET title=?,description=?,start=?,developers=? WHERE id=?",
  );
  const assigned = store.db.prepare(
    "SELECT developer_id FROM ticket_developers WHERE source=? AND ticket_id=? ORDER BY developer_id",
  );
  store.db.transaction(() => {
    for (const row of rows) {
      const developers = JSON.stringify(
        (assigned.all(row.source, row.id) as { developer_id: string }[]).map(d => d.developer_id),
      );
      const title = `Дедлайн #${row.id}: ${row.title || "тикет"}`;
      const start = new Date(Date.parse(row.deadline) - (row.lead_minutes == null ? lead : row.lead_minutes * 60000)).toISOString();
      if (title !== row.saved_title || start !== row.saved_start || developers !== row.saved_developers)
        update.run(
          title,
          `Локальный дедлайн: ${row.deadline}. Напоминание действует до ручного завершения.`,
          start,
          developers,
          row.event_id,
        );
    }
  })();
}
export const activeDeadlineSql =
  "(d.event_id IS NULL OR EXISTS (SELECT 1 FROM tickets t WHERE t.source=d.source AND t.id=d.id))";
