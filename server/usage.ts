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
    chatSessionId?: string,
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
    if (origin === "chat" && chatSessionId) this.store.db.prepare("UPDATE llm_requests SET chat_session_id=? WHERE id=?").run(chatSessionId, id);
    return id;
  }
  registerReviewRequest(reviewId: string, requestId: string) {
    const key = `review.requests:${reviewId}`;
    const ids = this.store.get<string[]>(key, []);
    if (!ids.includes(requestId)) this.store.set(key, [...ids, requestId]);
    this.pruneReviewTraces();
  }
  private pruneReviewTraces() {
    const latest = this.store.db.prepare("SELECT id FROM pr_reviews ORDER BY created_at DESC,rowid DESC LIMIT 1").get() as any;
    if (!latest) return;
    const keep = this.store.get<string[]>(`review.requests:${latest.id}`, []);
    this.store.db.prepare(`DELETE FROM llm_tool_traces WHERE request_id IN (
      SELECT id FROM llm_requests WHERE origin='pr_review'
      AND id NOT IN (SELECT value FROM json_each(?)))`).run(JSON.stringify(keep));
  }
  clearReviewTraces() {
    this.store.db.prepare("DELETE FROM llm_tool_traces WHERE request_id IN (SELECT id FROM llm_requests WHERE origin='pr_review')").run();
  }
  hasReviewLog(context: Context, monitor: string, repo: string, number: number) {
    const latest = this.store.db.prepare("SELECT id,monitor,repo,number FROM pr_reviews ORDER BY created_at DESC,rowid DESC LIMIT 1").get() as any;
    if (!latest || latest.monitor !== monitor || latest.repo !== repo || latest.number !== number) return false;
    const ids = this.store.get<string[]>(`review.requests:${latest.id}`, []);
    return !!this.store.db.prepare(`SELECT 1 FROM llm_requests
      WHERE origin='pr_review' AND client=? AND project=? AND id IN (SELECT value FROM json_each(?)) LIMIT 1`)
      .get(context.client, context.project, JSON.stringify(ids));
  }
  reviewTools(context: Context, monitor: string, repo: string, number: number) {
    const review = this.store.db.prepare(`SELECT r.id FROM pr_reviews r JOIN pr_projects m ON m.id=r.monitor
      WHERE r.monitor=? AND r.repo=? AND r.number=? AND m.client=? AND m.project=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1`)
      .get(monitor, repo, number, context.client, context.project) as any;
    if (!review) return { requests: [] };
    const latest = this.store.db.prepare("SELECT id FROM pr_reviews ORDER BY created_at DESC,rowid DESC LIMIT 1").get() as any;
    if (latest?.id !== review.id) return { requests: [] };
    this.pruneReviewTraces();
    const ids = this.store.get<string[]>(`review.requests:${review.id}`, []);
    const requests = this.store.db.prepare(`SELECT r.id,r.model,r.created_at,r.finished_at,r.status,r.reason,r.tool_calls,
      (SELECT sum(input_tokens) FROM llm_usage WHERE request_id=r.id) AS inputTokens,
      (SELECT sum(output_tokens) FROM llm_usage WHERE request_id=r.id) AS outputTokens
      FROM llm_requests r WHERE r.origin='pr_review' AND r.client=? AND r.project=? AND r.id IN (SELECT value FROM json_each(?)) ORDER BY r.created_at DESC,r.rowid DESC`)
      .all(context.client, context.project, JSON.stringify(ids)) as any[];
    return { requests: requests.map(request => ({ ...request, tools: this.store.db.prepare(
      "SELECT id,request_id,name,arguments,internal,status,result,started_at,finished_at,full_result IS NOT NULL AS hasFullResult FROM llm_tool_traces WHERE request_id=? ORDER BY started_at,rowid"
    ).all(request.id) })) };
  }
  reviewUsage(reviewId?: string, legacyRequestId?: string) {
    const ids = [...new Set([...(reviewId ? this.store.get<string[]>(`review.requests:${reviewId}`, []) : []), ...(legacyRequestId ? [legacyRequestId] : [])])];
    const totals = this.store.db.prepare(`SELECT sum(u.input_tokens) AS inputTokens, sum(u.output_tokens) AS outputTokens,
      count(u.receipt_id) AS reports,
      sum(CASE WHEN u.receipt_id IS NULL OR u.input_tokens IS NULL OR u.output_tokens IS NULL THEN 1 ELSE 0 END) AS missing
      FROM llm_requests r LEFT JOIN llm_usage u ON u.request_id=r.id
      WHERE r.origin='pr_review' AND r.id IN (SELECT value FROM json_each(?))`).get(JSON.stringify(ids)) as any;
    return { inputTokens: totals.inputTokens, outputTokens: totals.outputTokens,
      totalTokens: totals.inputTokens === null && totals.outputTokens === null ? null : (totals.inputTokens ?? 0) + (totals.outputTokens ?? 0),
      partial: !totals.reports || !!totals.missing };
  }
  reviewMetadata(reviewId?: string, legacyRequestId?: string) {
    const row = reviewId ? this.store.db.prepare("SELECT options FROM pr_reviews WHERE id=?").get(reviewId) as { options: string } | undefined : undefined;
    let options: any = {};
    try { options = JSON.parse(row?.options || "{}") || {}; } catch { /* Legacy metadata may be unavailable. */ }
    const ids = [...new Set([...(reviewId ? this.store.get<string[]>(`review.requests:${reviewId}`, []) : []), ...(legacyRequestId ? [legacyRequestId] : [])])];
    const totals = this.store.db.prepare("SELECT SUM(tool_calls) AS used,COUNT(*) AS requests FROM llm_requests WHERE origin='pr_review' AND id IN (SELECT value FROM json_each(?))").get(JSON.stringify(ids)) as { used: number | null; requests: number };
    return {
      toolCalls: totals.used,
      toolLimit: typeof options.maxToolCalls === "number" && Number.isInteger(options.maxToolCalls) && options.maxToolCalls >= 1 && options.maxToolCalls <= 1000 ? options.maxToolCalls : null,
      partial: totals.requests < ids.length || totals.requests === 0,
      reviewerComment: typeof options.reviewerComment === "string" ? options.reviewerComment : "",
    };
  }
  reviewTokens(reviewId: string) {
    return this.store.get<string[]>(`review.requests:${reviewId}`, []).reduce((sum, id) => sum + this.tokens(id), 0);
  }
  reviewToolCalls(reviewId: string) {
    const read = this.store.db.prepare("SELECT tool_calls FROM llm_requests WHERE id=?");
    return this.store.get<string[]>(`review.requests:${reviewId}`, []).reduce((sum, id) => sum + ((read.get(id) as { tool_calls: number } | undefined)?.tool_calls ?? 0), 0);
  }
  sessionUsage(context: Context, sessionId: string) {
    this.store.chatSession(context, sessionId);
    const usage = this.store.db.prepare(
      "SELECT coalesce(sum(u.input_tokens),0) AS inputTokens,coalesce(sum(u.output_tokens),0) AS outputTokens,count(u.receipt_id) AS reports FROM llm_requests r LEFT JOIN llm_usage u ON u.request_id=r.id WHERE r.chat_session_id=? AND r.client=? AND r.project=? AND r.origin='chat'",
    ).get(sessionId, context.client, context.project) as { inputTokens: number; outputTokens: number; reports: number };
    const legacy = !!this.store.db.prepare("SELECT 1 FROM conversations WHERE session_id=? AND role='assistant' AND request_id IS NULL LIMIT 1").get(sessionId);
    const snapshot = this.store.get<any>(`chat.context:${sessionId}`, null);
    const contextUsage = snapshot?.source === this.store.source() ? snapshot : null;
    return { ...usage, partial: legacy, contextUsage };
  }
  recordContext(sessionId: string, context: Context, data: { currentTokens: number; tokenLimit: number }, model: string) {
    this.store.chatSession(context, sessionId);
    if (!Number.isSafeInteger(data.currentTokens) || data.currentTokens < 0 || !Number.isSafeInteger(data.tokenLimit) || data.tokenLimit <= 0) return;
    this.store.set(`chat.context:${sessionId}`, { currentTokens: data.currentTokens, tokenLimit: data.tokenLimit, model, source: this.store.source(), updatedAt: new Date().toISOString() });
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
    const latest = this.store.db.prepare("SELECT id FROM pr_reviews ORDER BY created_at DESC,rowid DESC LIMIT 1").get() as any;
    const request = this.store.db.prepare("SELECT origin FROM llm_requests WHERE id=?").get(requestId) as any;
    if (latest && request?.origin === "pr_review" && !this.store.get<string[]>(`review.requests:${latest.id}`, []).includes(requestId)) return id;
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
      "azureTag",
      "type",
      "afterId",
      "offset",
      "limit",
    ]) {
      if (args?.[key] !== undefined) summary[key] = args[key];
    }
    if (name === "load_tools" && Array.isArray(args?.names)) summary.names = args.names.filter((name: unknown) => typeof name === "string").slice(0, 8).map((name: string) => name.slice(0, 100));
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
    const fullArgs = JSON.stringify(args ?? {});
    this.store.db.prepare("UPDATE llm_tool_traces SET full_arguments=? WHERE id=?").run(
      fullArgs.length <= 100000 ? fullArgs : JSON.stringify({ truncated: true, preview: fullArgs.slice(0, 100000) }), id);
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
  toolArguments(id: string, context: Context, origin = "chat") {
    const row = this.store.db.prepare("SELECT t.arguments,t.full_arguments FROM llm_tool_traces t JOIN llm_requests r ON r.id=t.request_id WHERE t.id=? AND r.origin=? AND r.client=? AND r.project=?")
      .get(id, origin, context.client, context.project) as any;
    if (!row) throw new AppError(404, "Вызов инструмента не найден");
    return { arguments: JSON.parse(row.full_arguments ?? row.arguments), full: row.full_arguments !== null };
  }
  toolResult(id: string, context: Context, origin = "chat") {
    const row = this.store.db.prepare(
      "SELECT t.full_result FROM llm_tool_traces t JOIN llm_requests r ON r.id=t.request_id WHERE t.id=? AND r.origin=? AND r.client=? AND r.project=?",
    ).get(id, origin, context.client, context.project) as { full_result: string | null } | undefined;
    if (!row) throw new AppError(404, "Вызов инструмента не найден в текущем чате");
    if (row.full_result === null) throw new AppError(404, "Полный результат не сохранён или вызов ещё выполняется");
    return { result: JSON.parse(row.full_result) };
  }
  chatTools(context: Context, sessionId?: string) {
    if (sessionId) this.store.chatSession(context, sessionId);
    const requests = this.store.db
      .prepare(
        "SELECT r.id,r.created_at,r.finished_at,r.status,r.reason,r.tool_calls,(SELECT sum(input_tokens) FROM llm_usage WHERE request_id=r.id) AS inputTokens,(SELECT sum(output_tokens) FROM llm_usage WHERE request_id=r.id) AS outputTokens FROM llm_requests r WHERE origin='chat' AND client=? AND project=? AND (? IS NULL OR chat_session_id=?) ORDER BY created_at DESC LIMIT 20",
      )
      .all(context.client, context.project, sessionId || null, sessionId || null) as any[];
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
