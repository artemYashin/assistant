import { Store, type Context } from "./store.js";

export function overviewUsage(store: Store, context: Context, now = Date.now()) {
  const scope = [context.client, context.client, context.project, context.project];
  const since = new Date(now - 49 * 86400000).toISOString();
  const until = new Date(now).toISOString();
  const cte = `WITH totals AS (SELECT request_id, SUM(COALESCE(input_tokens,0)) input, SUM(COALESCE(output_tokens,0)) output, COUNT(*) receipts, SUM(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 ELSE 0 END) incomplete FROM llm_usage GROUP BY request_id), scoped AS (SELECT r.*,COALESCE(t.input,0) input,COALESCE(t.output,0) output,COALESCE(t.receipts,0) receipts,COALESCE(t.incomplete,0) incomplete FROM llm_requests r LEFT JOIN totals t ON t.request_id=r.id WHERE (?='' OR r.client=?) AND (?='' OR r.project=?) AND r.created_at>=? AND r.created_at<=?)`;
  const summary = (start: string) =>
    store.db
      .prepare(
        cte +
          ` SELECT COUNT(*) requests,COALESCE(SUM(input),0) input,COALESCE(SUM(output),0) output,COALESCE(SUM(CASE WHEN receipts=0 OR incomplete>0 THEN 1 ELSE 0 END),0) incomplete FROM scoped`,
      )
      .get(...scope, start, until) as {
      requests: number;
      input: number;
      output: number;
      incomplete: number;
    };
  const rows = store.db
    .prepare(
      cte +
        ` SELECT substr(created_at,1,10) day,SUM(input) input,SUM(output) output FROM scoped GROUP BY day`,
    )
    .all(...scope, since, until) as {
    day: string;
    input: number;
    output: number;
  }[];
  const byDate = new Map(rows.map((row) => [row.day, row]));
  const daily = Array.from({ length: 49 }, (_, index) => {
    const day = new Date(now - (48 - index) * 86400000).toISOString().slice(0, 10);
    return byDate.get(day) || { day, input: 0, output: 0 };
  });
  const hourStart = Math.floor(now / 3600000) * 3600000 - 23 * 3600000;
  const hourlyRows = store.db
    .prepare(
      cte +
        ` SELECT substr(created_at,1,13) hour,SUM(input) input,SUM(output) output FROM scoped GROUP BY hour`,
    )
    .all(...scope, new Date(hourStart).toISOString(), until) as {
    hour: string;
    input: number;
    output: number;
  }[];
  const hours = new Map(hourlyRows.map((row) => [row.hour, row]));
  const hourly = Array.from({ length: 24 }, (_, index) => {
    const hour = new Date(hourStart + index * 3600000).toISOString().slice(0, 13);
    return hours.get(hour) || { hour, input: 0, output: 0 };
  });
  return {
    day: summary(new Date(now - 86400000).toISOString()),
    weeks: summary(since),
    daily,
    hourly,
    recent: recentUsage(store, context),
  };
}

export function recentUsage(store: Store, context: Context, limit = 8) {
  const scope = [context.client, context.client, context.project, context.project];
  const recent = store.db
    .prepare(
      `SELECT id,created_at,finished_at,origin,status,pull_request FROM llm_requests WHERE (?='' OR client=?) AND (?='' OR project=?) ORDER BY COALESCE(finished_at,created_at) DESC LIMIT ?`,
    )
    .all(...scope, limit) as any[];
  return recent.map((row) => {
    let pr = null;
    try {
      pr = row.pull_request ? JSON.parse(row.pull_request) : null;
    } catch {
      /* Old rows may lack PR metadata. */
    }
    if (pr && !pr.title) {
      const known = store.db
        .prepare("SELECT title FROM pull_requests WHERE monitor=? AND repo=? AND number=?")
        .get(pr.monitor, pr.repo, pr.number) as any;
      pr = { ...pr, title: known?.title || "Название недоступно" };
    }
    return { ...row, pull_request: pr };
  });
}
