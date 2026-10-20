import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store, AppError, type Context } from "./store.js";
import { defineTool } from "@github/copilot-sdk";

export class LocalDevelopers {
  constructor(private store: Store) {}
  list(context: Context) {
    return this.store.db
      .prepare(
        "SELECT id,name,client,project FROM local_developers WHERE active=1 AND ((client='' AND project='') OR (client=? AND (project='' OR project=?))) ORDER BY name COLLATE NOCASE,id",
      )
      .all(context.client, context.project) as {
      id: string;
      name: string;
      client: string;
      project: string;
    }[];
  }
  add(names: unknown, context: Context) {
    const parsed = z
      .array(z.string().trim().min(1).max(200))
      .min(1)
      .max(100)
      .parse(names);
    if (context.project && !context.client)
      throw new AppError(400, "Выберите заказчика");
    return this.store.db.transaction(() => {
      for (const name of parsed) {
        const existing = this.store.db
          .prepare(
            "SELECT id FROM local_developers WHERE client=? AND project=? AND lower(name)=lower(?)",
          )
          .get(context.client, context.project, name) as any;
        if (existing)
          this.store.db
            .prepare("UPDATE local_developers SET active=1 WHERE id=?")
            .run(existing.id);
        else
          this.store.db
            .prepare("INSERT INTO local_developers VALUES (?,?,?,?,1)")
            .run(randomUUID(), name, context.client, context.project);
      }
      return this.list(context);
    })();
  }
  edit(id: string, name: unknown) {
    const parsed = z.string().trim().min(1).max(200).parse(name);
    const person = this.store.db
      .prepare("SELECT * FROM local_developers WHERE id=? AND active=1")
      .get(id) as any;
    if (!person) throw new AppError(404, "Разработчик не найден");
    const duplicate = this.store.db
      .prepare(
        "SELECT id FROM local_developers WHERE id<>? AND client=? AND project=? AND lower(name)=lower(?)",
      )
      .get(id, person.client, person.project, parsed);
    if (duplicate) throw new AppError(409, "Имя уже есть в этом списке");
    this.store.db
      .prepare("UPDATE local_developers SET name=? WHERE id=?")
      .run(parsed, id);
  }
  remove(id: string) {
    this.store.db
      .prepare("UPDATE local_developers SET active=0 WHERE id=?")
      .run(id);
  }
  assigned(id: number, source = this.store.source()) {
    return this.store.db
      .prepare(
        "SELECT d.id,d.name,d.active FROM ticket_developers a JOIN local_developers d ON d.id=a.developer_id WHERE a.source=? AND a.ticket_id=? ORDER BY d.name COLLATE NOCASE,d.id",
      )
      .all(source, id) as { id: string; name: string; active: number }[];
  }
  assign(
    id: number,
    ids: unknown,
    context: Context,
    source = this.store.source(),
  ) {
    const selected = [
      ...new Set(z.array(z.string().min(1).max(200)).max(50).parse(ids)),
    ];
    if (source !== this.store.source())
      throw new AppError(
        409,
        "Подключение Azure изменилось. Обновите список тикетов.",
      );
    if (
      !this.store.db
        .prepare("SELECT 1 FROM tickets WHERE source=? AND id=?")
        .get(source, id)
    )
      throw new AppError(404, "Сначала добавьте тикет в локальный трекер");
    const allowed = new Set(
      [...this.list(context), ...this.assigned(id, source)].map((d) => d.id),
    );
    if (selected.some((id) => !allowed.has(id)))
      throw new AppError(
        400,
        "Разработчик недоступен в этом контексте. Обновите список.",
      );
    this.store.db.transaction(() => {
      this.store.db
        .prepare("DELETE FROM ticket_developers WHERE source=? AND ticket_id=?")
        .run(source, id);
      for (const developer of selected)
        this.store.db
          .prepare("INSERT INTO ticket_developers VALUES (?,?,?)")
          .run(source, id, developer);
      // Retain legacy display columns for older clients; assignments above are authoritative.
      const people = this.assigned(id, source);
      this.store.db
        .prepare(
          "INSERT INTO ticket_local(source,id,developer_id,developer_name) VALUES (?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET developer_id=excluded.developer_id,developer_name=excluded.developer_name",
        )
        .run(
          source,
          id,
          people[0]?.id || "",
          people.map((d) => d.name).join(", "),
        );
    })();
    this.store.audit("ticket.assigned_locally", String(id));
    return {
      success: true,
      id,
      developers: this.assigned(id, source),
      azureChanged: false,
    };
  }
}
export function localDeveloperTools(
  store: Store,
  context: Context,
  prompt: string,
  assertActive: () => void,
  isKnownTicket: (id: number) => boolean = () => false,
) {
  const service = new LocalDevelopers(store),
    source = store.source();
  const written = new Map<number, string>();
  return [
    defineTool("list_local_developers", {
      description:
        "Read locally configured developers available to current client/project. No Azure lookup. Optionally read current local assignees of a tracked ticket. Names are not Azure identities.",
      parameters: z.object({
        ticketId: z.number().int().positive().optional(),
      }),
      handler: async ({ ticketId }) => {
        assertActive();
        return {
          developers: service.list(context),
          assigned: ticketId ? service.assigned(ticketId) : undefined,
        };
      },
    }),
    defineTool("set_local_ticket_developers", {
      description:
        "Replace the local assignee list only on explicit current-user instruction naming the ticket and people. For add/remove, first read current assignees and preserve other people. Empty list clears all only when explicitly requested. No Azure writes.",
      parameters: z.object({
        ticketId: z.number().int().positive(),
        developerIds: z.array(z.string()).max(50),
      }),
      handler: async ({ ticketId, developerIds }) => {
        assertActive();
        const number = new RegExp(`(?<![0-9])${ticketId}(?![0-9])`).test(
          prompt,
        );
        if (
          (!number && !isKnownTicket(ticketId)) ||
          !/назнач|поруч|добавь|убери|сними|удали|assign|unassign|remove|add|clear/iu.test(
            prompt,
          ) ||
          /не надо|не нужно|не\s+(?:назнач|поруч|добав|убир|сним|удал)|do not|don't/iu.test(
            prompt,
          )
        )
          throw new AppError(
            403,
            "Нужна явная команда с именами разработчиков и тикетом из сообщения или инструментов текущего запроса",
          );
        const current = service.assigned(ticketId, source),
          people = [...service.list(context), ...current];
        const desired = new Set(developerIds),
          before = new Set(current.map((d) => d.id));
        const changed = [...new Set([...developerIds, ...before])].filter(
          (id) => desired.has(id) !== before.has(id),
        );
        const clearAll =
          !developerIds.length &&
          /всех|все поручения|снять поручение|сними поручение|clear|unassign all|remove all/iu.test(
            prompt,
          );
        if (
          !clearAll &&
          changed.some((id) => {
            const person = people.find((p) => p.id === id);
            return (
              !person ||
              !prompt
                .toLocaleLowerCase()
                .includes(person.name.toLocaleLowerCase())
            );
          })
        )
          throw new AppError(
            403,
            "Назовите точные имена изменяемых исполнителей из локального списка",
          );
        const signature = JSON.stringify([...desired].sort());
        if (written.has(ticketId) && written.get(ticketId) !== signature)
          throw new AppError(
            409,
            "Одно изменение поручения на тикет за сообщение",
          );
        if (written.has(ticketId))
          return {
            success: true,
            id: ticketId,
            developers: service.assigned(ticketId, source),
            azureChanged: false,
          };
        const result = service.assign(ticketId, developerIds, context, source);
        written.set(ticketId, signature);
        return result;
      },
    }),
  ];
}
