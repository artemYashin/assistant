import { randomUUID } from "node:crypto";
import { Store, AppError, type Context } from "./store.js";
export type UsagePullRequest = {
  monitor: string;
  repo: string;
  number: number;
  title: string;
};
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
  begin(
    model: string,
    context: Context,
    origin: "chat" | "pr_review" | "unknown" = "unknown",
    pullRequest?: UsagePullRequest,
  ) {
    const id = randomUUID();
    this.store.db
      .prepare(
        "INSERT INTO llm_requests(id,created_at,model,client,project,origin,pull_request,status) VALUES (?,?,?,?,?,?,?,'running')",
      )
      .run(
        id,
        new Date().toISOString(),
        model || "По умолчанию",
        context.client,
        context.project,
        origin,
        origin === "pr_review" && pullRequest
          ? JSON.stringify(pullRequest)
          : null,
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
  toolTrace(
    requestId: string,
    name: string,
    args: any,
    internal: boolean,
    status = "running",
  ) {
    const id = randomUUID();
    // Record identifiers and operation shape, never notes, message bodies or secrets.
    const summary: Record<string, unknown> = {};
    for (const key of [
      "id",
      "ticketId",
      "ids",
      "state",
      "detail",
      "contentOffset",
      "search",
      "type",
      "afterId",
      "offset",
      "limit",
    ]) {
      if (args?.[key] !== undefined) summary[key] = args[key];
    }
    summary.fields = Object.keys(args || {}).filter(
      (key) => !Object.hasOwn(summary, key),
    );
    if (args?.metadata && typeof args.metadata === "object")
      summary.metadataFields = Object.keys(args.metadata);
    if (Array.isArray(args?.operations))
      summary.operations = args.operations.slice(0, 50).map((op: any) => ({
        action: op.action,
        id: op.id ?? op.data?.id,
        fields: op.data
          ? Object.keys(op.data).filter((key) => key !== "id")
          : undefined,
      }));
    this.store.db
      .prepare(
        "INSERT INTO llm_tool_traces(id,request_id,name,arguments,internal,status,started_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        id,
        requestId,
        name,
        JSON.stringify(summary).slice(0, 16000),
        internal ? 1 : 0,
        status,
        new Date().toISOString(),
      );
    return id;
  }
  finishToolTrace(id: string, status: string, result: any) {
    const summary: Record<string, unknown> = {};
    for (const key of [
      "success",
      "error",
      "reference",
      "code",
      "total",
      "succeeded",
      "failed",
      "hasMore",
      "nextAfterId",
      "nextContentOffset",
      "totalCandidates",
      "scanned",
      "truncated",
    ])
      if (result?.[key] !== undefined) summary[key] = result[key];
    if (Array.isArray(result?.tickets))
      summary.ticketIds = result.tickets.map((ticket: any) => ticket.id);
    if (Array.isArray(result?.results))
      summary.results = result.results.map((item: any) => ({
        id: item.id,
        success: item.success,
        error: item.error,
        reference: item.reference,
      }));
    this.store.db
      .prepare(
        "UPDATE llm_tool_traces SET status=?, result=?, full_result=?, finished_at=? WHERE id=?",
      )
      .run(
        status,
        JSON.stringify(summary).slice(0, 24000),
        JSON.stringify(result ?? null),
        new Date().toISOString(),
        id,
      );
  }
  toolResult(id: string, context: Context) {
    const row = this.store.db.prepare(
      "SELECT t.full_result FROM llm_tool_traces t JOIN llm_requests r ON r.id=t.request_id WHERE t.id=? AND r.origin='chat' AND r.client=? AND r.project=?",
    ).get(id, context.client, context.project) as { full_result: string | null } | undefined;
    if (!row) throw new AppError(404, "Вызов инструмента не найден в текущем чате");
    if (row.full_result === null) throw new AppError(404, "Полный результат не сохранён или вызов ещё выполняется");
    return { result: JSON.parse(row.full_result) };
  }
  chatTools(context: Context) {
    const requests = this.store.db
      .prepare(
        "SELECT id,created_at,finished_at,status,reason,tool_calls FROM llm_requests WHERE origin='chat' AND client=? AND project=? ORDER BY created_at DESC LIMIT 20",
      )
      .all(context.client, context.project) as any[];
    return {
      requests: requests.map((request) => ({
        ...request,
        tools: (
          this.store.db
            .prepare(
              "SELECT id,request_id,name,arguments,internal,status,result,started_at,finished_at,full_result IS NOT NULL AS hasFullResult FROM llm_tool_traces WHERE request_id=? ORDER BY started_at,rowid LIMIT 500",
            )
            .all(request.id) as any[]
        ).map((tool) => ({ ...tool, internal: Boolean(tool.internal) })),
      })),
    };
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
    return {
      summary,
      requests: (requests as any[]).map((request) => ({
        ...request,
        pull_request: request.pull_request
          ? JSON.parse(request.pull_request)
          : null,
      })),
      days,
    };
  }
}
