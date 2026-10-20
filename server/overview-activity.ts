import { Store } from "./store.js";

export function overviewAudit(store: Store, limit = 8) {
  return (
    store.db
      .prepare("SELECT * FROM audit ORDER BY created_at DESC LIMIT ?")
      .all(limit) as any[]
  ).map((row) => {
    if (!row.action.startsWith("pr.")) return row;
    let parsed: any;
    try {
      parsed = JSON.parse(row.detail);
    } catch {
      /* Legacy plain-text event. */
    }
    let pr = parsed?.pull_request;
    let detail = parsed?.detail ?? row.detail;
    if (!pr) {
      let key: any;
      if (row.action === "pr.merge.requested" && parsed?.id)
        key = store.db
          .prepare(
            "SELECT json_extract(body,'$.monitor') monitor,json_extract(body,'$.repo') repo,json_extract(body,'$.number') number FROM pr_merge_plans WHERE id=?",
          )
          .get(parsed.id);
      else if (row.action === "pr.answers_submitted")
        key = store.db
          .prepare("SELECT monitor,repo,number FROM pr_reviews WHERE id=?")
          .get(row.detail);
      else if (row.action === "pr.questions_ignored")
        key = store.db
          .prepare(
            "SELECT r.monitor,r.repo,r.number FROM pr_reviews r JOIN pr_question_batches q ON q.review_id=r.id WHERE q.id=?",
          )
          .get(row.detail);
      if (key) pr = key;
      else {
        const number = /PR #(\d+)/.exec(detail)?.[1];
        if (number) {
          const matches = store.db
            .prepare(
              "SELECT monitor,repo,number,title FROM pull_requests WHERE number=? LIMIT 2",
            )
            .all(Number(number));
          if (matches.length === 1) pr = matches[0];
        }
      }
    }
    if (pr && !pr.title) {
      const match = store.db
        .prepare(
          "SELECT title FROM pull_requests WHERE monitor=? AND repo=? AND number=?",
        )
        .get(pr.monitor, pr.repo, pr.number) as any;
      pr = { ...pr, title: match?.title || "Название недоступно" };
    }
    return { ...row, detail, pull_request: pr };
  });
}
