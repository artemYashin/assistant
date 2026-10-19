import { randomUUID } from "node:crypto";
import { Store, type Context } from "./store.js";
export type UsageReceipt = {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  apiCallId?: string;
  accounting?: { sourceSessionId: string; sequence: number; usageId: string };
};
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
export class UsageLedger {
  constructor(private store: Store) {}
  begin(model: string, context: Context) {
    const id = randomUUID();
    this.store.db
      .prepare(
        "INSERT INTO llm_requests(id,created_at,model,client,project,status) VALUES (?,?,?,?,?,'running')",
      )
      .run(
        id,
        new Date().toISOString(),
        model || "По умолчанию",
        context.client,
        context.project,
      );
    return id;
  }
  record(id: string, eventId: string, data: UsageReceipt) {
    const receipt = data.accounting
      ? `accounting:${data.accounting.sourceSessionId}:${data.accounting.sequence}`
      : data.apiCallId
        ? `api:${data.apiCallId}`
        : `event:${eventId}`;
    this.store.db
      .prepare("INSERT OR IGNORE INTO llm_usage VALUES (?,?,?,?,?,?,?)")
      .run(
        id,
        receipt,
        data.model || "Не указана",
        count(data.inputTokens),
        count(data.outputTokens),
        count(data.cacheReadTokens),
        count(data.cacheWriteTokens),
      );
  }
  tool(id: string) {
    this.store.db
      .prepare("UPDATE llm_requests SET tool_calls=tool_calls+1 WHERE id=?")
      .run(id);
  }
  tokens(id: string) {
    const row = this.store.db
      .prepare(
        "SELECT coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0) n FROM llm_usage WHERE request_id=?",
      )
      .get(id) as { n: number };
    return row.n;
  }
  finish(id: string, status: string, reason?: string) {
    this.store.db
      .prepare(
        "UPDATE llm_requests SET status=?,reason=?,finished_at=? WHERE id=?",
      )
      .run(status, reason || null, new Date().toISOString(), id);
  }
  report(days = 0) {
    const since = days
      ? new Date(Date.now() - days * 86400000).toISOString()
      : "";
    const cte = `WITH totals AS (SELECT request_id,count(*) AS model_calls,sum(input_tokens) AS input_tokens,sum(output_tokens) AS output_tokens,sum(cache_read_tokens) AS cache_read_tokens,sum(cache_write_tokens) AS cache_write_tokens,sum(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 ELSE 0 END) AS incomplete_calls,group_concat(DISTINCT model) AS models FROM llm_usage GROUP BY request_id), requests AS (SELECT r.*,t.model_calls,t.input_tokens,t.output_tokens,t.cache_read_tokens,t.cache_write_tokens,t.incomplete_calls,t.models FROM llm_requests r LEFT JOIN totals t ON t.request_id=r.id WHERE r.created_at>=?)`;
    const summary = this.store.db
      .prepare(
        cte +
          ` SELECT count(*) requests,coalesce(sum(model_calls),0) model_calls,coalesce(sum(input_tokens),0) input_tokens,coalesce(sum(output_tokens),0) output_tokens,coalesce(sum(cache_read_tokens),0) cache_read_tokens,coalesce(sum(cache_write_tokens),0) cache_write_tokens,coalesce(sum(CASE WHEN model_calls IS NULL THEN 1 ELSE 0 END),0) unreported_requests,coalesce(sum(CASE WHEN incomplete_calls>0 OR status IN ('error','interrupted','stopped','limited') THEN 1 ELSE 0 END),0) possibly_partial_requests FROM requests`,
      )
      .get(since);
    const requests = this.store.db
      .prepare(
        cte + " SELECT * FROM requests ORDER BY created_at DESC LIMIT 100",
      )
      .all(since);
    return { summary, requests, days };
  }
}
