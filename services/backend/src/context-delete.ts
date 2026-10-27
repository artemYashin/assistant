import { AppError, Store, type Context } from "./store.js";

/** Context-owned records only. Azure ticket data and Git object caches are shared by source. */
export function deleteContext(store: Store, context: Context, confirmation: string) {
  if (confirmation !== "удалить")
    throw new AppError(400, "Для подтверждения введите слово «удалить».");
  if (!context.client) throw new AppError(400, "Общий контекст нельзя удалить.");
  if (
    !store
      .contexts()
      .some(
        (c) => c.client === context.client && (!context.project || c.project === context.project),
      )
  )
    throw new AppError(404, "Заказчик или проект не найден.");
  const where = context.project ? "client=? AND project=?" : "client=?";
  const args = context.project ? [context.client, context.project] : [context.client];
  return store.db.transaction(() => {
    const ids = (table: string) =>
      (
        store.db.prepare(`SELECT id FROM ${table} WHERE ${where}`).all(...args) as { id: string }[]
      ).map((r) => r.id);
    const monitors = ids("pr_projects"),
      chats = ids("chat_sessions"),
      developers = ids("local_developers"),
      requests = ids("llm_requests");
    const reviews = monitors.flatMap((id) =>
      (
        store.db.prepare("SELECT id FROM pr_reviews WHERE monitor=?").all(id) as { id: string }[]
      ).map((r) => r.id),
    );
    if (
      reviews.some((id) =>
        store.db
          .prepare("SELECT 1 FROM pr_reviews WHERE id=? AND status IN ('running','preparing_git')")
          .get(id),
      )
    )
      throw new AppError(
        409,
        "Дождитесь завершения или остановите активное ревью перед удалением.",
      );
    for (const id of reviews) {
      for (const table of ["pr_question_batches", "pr_review_attempts"])
        store.db.prepare(`DELETE FROM ${table} WHERE review_id=?`).run(id);
    }
    for (const id of monitors) {
      for (const table of [
        "pull_requests",
        "pr_reviews",
        "pr_completed",
        "pr_ticket_links",
        "pr_ticket_exclusions",
      ])
        store.db.prepare(`DELETE FROM ${table} WHERE monitor=?`).run(id);
    }
    for (const id of requests) {
      store.db.prepare("DELETE FROM llm_tool_traces WHERE request_id=?").run(id);
      store.db.prepare("DELETE FROM llm_usage WHERE request_id=?").run(id);
    }
    for (const id of developers) {
      store.db.prepare("DELETE FROM ticket_developers WHERE developer_id=?").run(id);
      store.db
        .prepare("UPDATE ticket_local SET developer_id='',developer_name='' WHERE developer_id=?")
        .run(id);
    }
    const exactKeys = new Set([
      ...chats.flatMap((id) => [`chat.active:${id}`, `chat.runtime:${id}`, `chat.context:${id}`]),
      ...reviews.flatMap((id) => [
        `review.requests:${id}`,
        `chat.runtime:review:${id}`,
        `chat.context:review:${id}`,
      ]),
      ...monitors.map((id) => `code-sync:${id}`),
    ]);
    const offsets: Record<string, number> = {
      "ticket-import:": 0,
      "ticket-kanban:": 0,
      "azure.context:": 0,
      "project.azure:": 1,
      "chat.active:": 0,
      "ticket-priorities:": 0,
      "developer-note:": 0,
      "developer-status-groups:": 1,
    };
    for (const { key } of store.db.prepare("SELECT key FROM kv").all() as { key: string }[]) {
      let remove =
        exactKeys.has(key) || monitors.some((id) => key.startsWith(`code.snapshot:${id}:`));
      const prefix = Object.keys(offsets).find((prefix) => key.startsWith(prefix));
      if (prefix) {
        try {
          const parts = JSON.parse(key.slice(prefix.length)),
            i = offsets[prefix];
          remove ||=
            Array.isArray(parts) &&
            parts[i] === context.client &&
            (!context.project || parts[i + 1] === context.project);
        } catch {
          /* Unrelated legacy keys are preserved. */
        }
      }
      for (const prefix of ["pr.source:", "pr.azureLinks:"]) {
        if (key.startsWith(prefix)) {
          try {
            remove ||= monitors.includes(JSON.parse(key.slice(prefix.length))[0]);
          } catch {
            /* Not a scoped entry. */
          }
        }
      }
      if (remove) store.db.prepare("DELETE FROM kv WHERE key=?").run(key);
    }
    for (const table of [
      "calendar_events",
      "contexts",
      "memories",
      "memory_proposals",
      "conversations",
      "chat_sessions",
      "pr_projects",
      "llm_requests",
      "local_developers",
    ])
      store.db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...args);
    const current = store.rawSettings();
    if (
      current.client === context.client &&
      (!context.project || current.project === context.project)
    )
      store.set("settings", {
        ...current,
        client: context.project ? context.client : "",
        project: "",
      });
    store.audit("context.deleted", JSON.stringify(context));
    const { client, project } = store.settings();
    return { items: store.contexts(), context: { client, project } };
  })();
}
