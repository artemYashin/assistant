/** Read-only union of active tickets and retained trash. */
export function localTicketScope(now = Date.now()) {
  const cutoff = Math.trunc(now - 30 * 86400000);
  return `WITH local_tickets AS (
    SELECT source,id,title,state,assigned,type,changed_at,synced_at,0 AS deleted FROM tickets
    UNION ALL
    SELECT r.source,r.id,json_extract(r.body,'$.title'),json_extract(r.body,'$.state'),
      json_extract(r.body,'$.assigned'),json_extract(r.body,'$.type'),
      json_extract(r.body,'$.changed_at'),json_extract(r.body,'$.synced_at'),1 AS deleted
    FROM ticket_trash r WHERE r.removed_at>${cutoff}
      AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.source=r.source AND t.id=r.id)
  )`;
}
