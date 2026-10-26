import { memoryWritingGuide } from "./memory-policy.js";
import { memorySummarySchema, legacyMemorySummary } from "./memory-summary.js";
import { randomUUID } from "node:crypto";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { Store, AppError, type Context } from "./store.js";

const proposalSchema = z.object({
  summary: memorySummarySchema.optional(),
  scope: z.enum(["general", "client", "project", "project_review"]),
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
    if (["project", "project_review"].includes(p.scope) && !context.project)
      throw new AppError(400, "Выберите проект для проектной памяти");
    const client = p.scope === "general" ? "" : context.client;
    const project = ["project", "project_review"].includes(p.scope) ? context.project : "";
    const existing = this.store.db
      .prepare(
        "SELECT id FROM memories WHERE scope=? AND client=? AND project=? AND body=?",
      )
      .get(p.scope, client, project, p.body);
    if (existing) return { status: "already_saved" };
    const old = this.store.db
      .prepare(
        "SELECT id FROM memory_proposals WHERE scope=? AND client=? AND project=? AND body=? AND status='pending' AND target_memory_id IS NULL",
      )
      .get(p.scope, client, project, p.body) as any;
    if (old) return { id: old.id, status: "pending" };
    const id = randomUUID();
    this.store.db
      .prepare(
        "INSERT INTO memory_proposals(id,scope,client,project,body,reason,status,created_at,summary) VALUES (?,?,?,?,?,?,'pending',?,?)",
      )
      .run(
        id,
        p.scope,
        client,
        project,
        p.body,
        p.reason,
        new Date().toISOString(),
        p.summary ?? legacyMemorySummary(p.body),
      );
    this.store.audit("memory.proposed", id);
    return {
      id,
      status: "pending",
      note: "Запись ещё не сохранена в память. Ожидает подтверждения в интерфейсе.",
    };
  }
  proposeEdit(memoryId: string, context: Context) {
    return this.store.db.transaction(() => {
      const memory = this.store.memoryDetail(memoryId, context);
      const existing = this.store.db.prepare("SELECT * FROM memory_proposals WHERE target_memory_id=? AND status='pending' AND original_summary=? AND original_body=? ORDER BY created_at DESC LIMIT 1")
        .get(memoryId, memory.summary, memory.body) as any;
      if (existing) return existing;
      const id = randomUUID();
      this.store.db.prepare("INSERT INTO memory_proposals(id,scope,client,project,summary,body,reason,status,created_at,target_memory_id,original_summary,original_body) VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?)")
        .run(id, memory.scope, memory.scope === "general" ? "" : context.client,
          ["project", "project_review"].includes(memory.scope) ? context.project : "",
          memory.summary, memory.body, "Редактирование сохранённой памяти с помощью AI", new Date().toISOString(), memoryId, memory.summary, memory.body);
      this.store.audit("memory.proposed", id);
      return this.forContext(id, context);
    })();
  }
  forContext(id: string, context: Context) {
    const p = this.store.db.prepare("SELECT * FROM memory_proposals WHERE id=?").get(id) as any;
    if (!p || (p.scope !== "general" && p.client !== context.client) || (["project", "project_review"].includes(p.scope) && p.project !== context.project)) throw new AppError(404, "Предложение недоступно в выбранном заказчике и проекте");
    if (p.status !== "pending") throw new AppError(409, "Предложение уже обработано");
    return p;
  }
  edit(id: string, input: unknown, expectedBody?: string, expectedSummary?: string) {
    const { body, summary } = proposalSchema.pick({ body: true, summary: true }).parse(input);
    return this.store.db.transaction(() => {
      const proposal = this.store.db.prepare("SELECT status,body,summary FROM memory_proposals WHERE id=?").get(id) as any;
      if (!proposal) throw new AppError(404, "Предложение не найдено");
      if (proposal.status !== "pending") throw new AppError(409, "Предложение уже обработано. Сохранённую запись можно изменить на странице памяти.");
      if (expectedBody !== undefined && proposal.body !== expectedBody) throw new AppError(409, "Предложение изменилось. Прочитайте актуальный текст перед редактированием.");
      if (expectedSummary !== undefined && proposal.summary !== expectedSummary) throw new AppError(409, "Краткое описание изменилось. Прочитайте предложение заново.");
      this.store.db.prepare("UPDATE memory_proposals SET body=?,summary=? WHERE id=?").run(body, summary ?? proposal.summary, id);
      this.store.audit("memory.proposal_edited", id);
      return { ok: true };
    })();
  }
  decide(id: string, approve: boolean) {
    return this.store.db.transaction(() => {
      const p = this.store.db
        .prepare("SELECT * FROM memory_proposals WHERE id=?")
        .get(id) as any;
      if (!p) throw new AppError(404, "Предложение не найдено");
      if (p.status !== "pending")
        throw new AppError(409, "Предложение уже обработано");
      if (approve && p.target_memory_id) {
        const result = this.store.db.prepare("UPDATE memories SET summary=?,body=? WHERE id=? AND summary=? AND body=? AND scope=? AND client=? AND project=?")
          .run(p.summary, p.body, p.target_memory_id, p.original_summary, p.original_body, p.scope, p.client, p.project);
        if (!result.changes) throw new AppError(409, "Исходная память изменена или удалена. Создайте новое предложение на основе актуальной записи.");
        this.store.audit("memory.updated", p.target_memory_id);
      } else if (approve) {
        const old = this.store.db
          .prepare(
            "SELECT id FROM memories WHERE scope=? AND client=? AND project=? AND body=?",
          )
          .get(p.scope, p.client, p.project, p.body);
        if (!old)
          this.store.addMemory(p.scope, p.body, {
            client: p.client,
            project: p.project,
          }, p.summary);
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
      "Propose requested or useful durable knowledge for human approval; returns pending, not saved. " + memoryWritingGuide(store.settings().memoryLanguage),
    parameters: proposalSchema.extend({ summary: memorySummarySchema.describe("One or two short sentences identifying this memory; always visible in the catalog. No code blocks.") }),
    handler: async (args) => {
      assertActive();
      if (++calls > 5)
        throw new AppError(400, "Не более пяти предложений памяти за запрос");
      return new MemoryProposals(store).propose(args, context);
    },
  });
}

export function memoryRefinementTools(store: Store, context: Context, assertActive: () => void, onEdited: () => void) {
  const service = new MemoryProposals(store);
  return [
    defineTool("read_memory_proposal", {
      description: "Read a pending memory proposal in current scope to refine it. Does not read or change saved memory.",
      parameters: z.object({ id: z.string().uuid() }),
      handler: async ({ id }) => { assertActive(); return service.forContext(id, context); },
    }),
    defineTool("edit_memory_proposal", {
      description: "Refine an existing pending memory proposal at the user's request, including updates to saved memories identified by target_memory_id. For an update, edit only the proposed summary/body; approval later updates the original record. Supply the short summary (one or two sentences) and complete replacement Markdown body, plus exact previous summary and body from attachment/read_memory_proposal to avoid overwriting concurrent edits. original_summary/original_body are immutable before-values, not editable fields. Does not approve or save to memory. No extra confirmation needed for this draft edit. " + memoryWritingGuide(store.settings().memoryLanguage),
      parameters: z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(8000), summary: memorySummarySchema, expectedSummary: z.string().max(320), expectedBody: z.string().max(8000) }),
      handler: async ({ id, body, summary, expectedBody, expectedSummary }) => { assertActive(); service.forContext(id, context); service.edit(id, { body, summary }, expectedBody, expectedSummary); onEdited(); return { id, status: "pending", updated: true }; },
    }),
  ];
}
