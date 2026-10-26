import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { UsageLedger } from "../services/backend/src/usage.js";
import { overviewUsage } from "../services/backend/src/overview-usage.js";

test("overview tokens use scoped rolling windows, zero-fill days and retain PR origin", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-overview-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const ledger = new UsageLedger(store);
  const context = { client: "C", project: "P" };
  const now = Date.parse("2026-10-20T12:00:00Z");
  const create = (days: number, ctx = context, origin: "chat" | "pr_review" = "chat") => {
    const id = ledger.begin(
      "model",
      ctx,
      origin,
      origin === "pr_review"
        ? { monitor: "m", repo: "r", number: 42, title: "Review this" }
        : undefined,
    );
    store.db
      .prepare("UPDATE llm_requests SET created_at=? WHERE id=?")
      .run(new Date(now - days * 86400000).toISOString(), id);
    return id;
  };
  const current = create(0.5);
  ledger.record(current, "a", { inputTokens: 100, outputTokens: 20 });
  ledger.record(current, "a", { inputTokens: 100, outputTokens: 20 });
  const older = create(2, context, "pr_review");
  ledger.record(older, "b", { inputTokens: 300, outputTokens: 40 });
  create(0.1); // Request with no usage receipt must not look like a known zero.
  ledger.record(create(50), "c", { inputTokens: 999, outputTokens: 999 });
  ledger.record(create(0, { client: "Other", project: "P" }), "d", {
    inputTokens: 999,
    outputTokens: 999,
  });
  const result = overviewUsage(store, context, now);
  assert.deepEqual(result.day, {
    requests: 2,
    input: 100,
    output: 20,
    incomplete: 1,
  });
  assert.deepEqual(result.weeks, {
    requests: 3,
    input: 400,
    output: 60,
    incomplete: 1,
  });
  assert.equal(result.daily.length, 49);
  assert.equal(result.hourly.length, 24);
  assert.equal(result.hourly.at(-1)?.hour, "2026-10-20T12");
  assert.equal(
    result.hourly.reduce((sum, hour) => sum + hour.input, 0),
    100,
  );
  assert.equal(
    result.hourly.reduce((sum, hour) => sum + hour.output, 0),
    20,
  );

  assert.equal(
    result.daily.reduce((n, row) => n + row.input, 0),
    400,
  );
  assert.ok(result.daily.some((row) => row.input === 0 && row.output === 0));
  assert.equal(result.recent.find((row) => row.id === older)?.pull_request.number, 42);
  assert.equal(result.recent.length, 4);
});
