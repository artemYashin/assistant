import { randomUUID } from "node:crypto";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { Store, AppError, type Context } from "./store.js";

const proposalSchema = z.object({
  scope: z.enum(["general", "client", "project"]),
  body: z.string().trim().min(1).max(8000),
  reason: z.string().trim().min(1).max(1000),
});
export class MemoryProposals {
  constructor(private store: Store) {}
  list() {
    return this.store.db
      .prepare(
        "SELECT * FROM memory_proposals ORDER BY created_at DESC,rowid DESC LIMIT 200",
      )
      .all();
  }
  propose(input: unknown, context: Context) {
    const p = proposalSchema.parse(input);
    if (p.scope !== "general" && !context.client)
      throw new AppError(400, "Выберите заказчика для этой области памяти");
    if (p.scope === "project" && !context.project)
      throw new AppError(400, "Выберите проект для проектной памяти");
    const client = p.scope === "general" ? "" : context.client;
    const project = p.scope === "project" ? context.project : "";
    const existing = this.store.db
      .prepare(
        "SELECT id FROM memories WHERE scope=? AND client=? AND project=? AND body=?",
      )
      .get(p.scope, client, project, p.body);
    if (existing) return { status: "already_saved" };
    const old = this.store.db
      .prepare(
        "SELECT id FROM memory_proposals WHERE scope=? AND client=? AND project=? AND body=? AND status='pending'",
      )
      .get(p.scope, client, project, p.body) as any;
    if (old) return { id: old.id, status: "pending" };
    const id = randomUUID();
    this.store.db
      .prepare(
        "INSERT INTO memory_proposals(id,scope,client,project,body,reason,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)",
      )
      .run(
        id,
        p.scope,
        client,
        project,
        p.body,
        p.reason,
        new Date().toISOString(),
      );
    this.store.audit("memory.proposed", id);
    return {
      id,
      status: "pending",
      note: "Запись ещё не сохранена в память. Ожидает подтверждения в интерфейсе.",
    };
  }
  decide(id: string, approve: boolean) {
    return this.store.db.transaction(() => {
      const p = this.store.db
        .prepare("SELECT * FROM memory_proposals WHERE id=?")
        .get(id) as any;
      if (!p) throw new AppError(404, "Предложение не найдено");
      if (p.status !== "pending")
        throw new AppError(409, "Предложение уже обработано");
      if (approve) {
        const old = this.store.db
          .prepare(
            "SELECT id FROM memories WHERE scope=? AND client=? AND project=? AND body=?",
          )
          .get(p.scope, p.client, p.project, p.body);
        if (!old)
          this.store.addMemory(p.scope, p.body, {
            client: p.client,
            project: p.project,
          });
      }
      this.store.db
        .prepare("UPDATE memory_proposals SET status=? WHERE id=?")
        .run(approve ? "approved" : "rejected", id);
      return { status: approve ? "approved" : "rejected" };
    })();
  }
}
export function memoryProposalTool(
  store: Store,
  context: Context,
  assertActive: () => void,
) {
  let calls = 0;
  return defineTool("propose_memory", {
    description:
      "Propose a concise durable fact or rule for human approval. Use for useful inferred knowledge without an explicit save request. Does NOT save memory; never claim saved until approved. No secrets or speculative facts. Choose narrowest applicable scope, preserve meaning and remove conversational filler.",
    parameters: proposalSchema,
    handler: async (args) => {
      assertActive();
      if (++calls > 5)
        throw new AppError(400, "Не более пяти предложений памяти за запрос");
      return new MemoryProposals(store).propose(args, context);
    },
  });
}
