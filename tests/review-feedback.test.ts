import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageLedger } from "../server/usage.js";
import { Store } from "../server/store.js";
import { PullRequests } from "../server/pull-requests.js";
import { ReviewQuestions, reviewOptionsSchema } from "../server/review-questions.js";
import { MemoryProposals } from "../server/memory-proposals.js";
const context = { client: "Customer", project: "Project" };
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-feedback-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("memory proposals await approval, retain original scope and cannot be approved twice", (t) => {
  const store = fixture(t),
    proposals = new MemoryProposals(store);
  const input = {
    scope: "project",
    body: "Use UTC for audit timestamps.",
    reason: "Consistent timestamp contract",
  };
  const p = proposals.propose(input, context);
  assert.equal(store.memories(context).length, 0);
  assert.equal(proposals.propose(input, context).id, p.id);
  proposals.decide(p.id!, true);
  assert.equal((store.memories(context)[0] as any).body, input.body);
  assert.equal(
    store.memories({ client: "Customer", project: "Other" }).length,
    0,
  );
  assert.throws(() => proposals.decide(p.id!, true), /уже обработано/);
  assert.equal(proposals.propose(input, context).status, "already_saved");
  const rejected = proposals.propose(
    { ...input, scope: "general", body: "Rejected fact" },
    context,
  );
  proposals.decide(rejected.id!, false);
  assert.equal(store.memories(context).length, 1);
  assert.throws(
    () => proposals.propose(input, { client: "", project: "" }),
    /заказчика/,
  );
});
test("review answers are all-or-nothing, enqueue once and reject changed PR versions", (t) => {
  const store = fixture(t);
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/org",
    azureProject: "P",
    reviewMaxTokens: 1500000,
    reviewMaxToolCalls: 47,
  });
  store.setSecret("azure.pat", "pat");
  store.setSecret("github.token", "token");
  const service = new PullRequests(store, {
    active: () => null,
    chat: async () => ({ body: "", requestId: "" }),
  });
  service.save({ ...context, repository: "repo", mode: "all", enabled: true });
  const monitor = service.monitors()[0].id;
  store.db
    .prepare(
      "INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      monitor,
      "repo",
      1,
      "Title",
      "Author",
      "https://ado.test/pr",
      "head",
      "target",
      0,
      1,
      "now",
    );
  const review = service.requestReview(monitor, "repo", 1);
  const options = JSON.parse((store.db.prepare("SELECT options FROM pr_reviews WHERE id=?").get(review) as any).options);
  assert.equal(options.maxTokens, 1500000);
  assert.equal(options.maxToolCalls, 47);
  assert.equal(options.readCode, true);
  store.db
    .prepare("UPDATE pr_reviews SET status='awaiting_answers' WHERE id=?")
    .run(review);
  const questions = new ReviewQuestions(store);
  const batch = questions.create(review, [
    { question: "Timeout?", reason: "Retry behavior" },
    { question: "Nullable?", reason: "Input validation" },
  ]);
  assert.throws(() => questions.answer(batch, ["30 seconds"]), /все вопросы/);
  assert.throws(() => questions.answer(batch, ["30 seconds", ""]));
  assert.equal(
    (
      store.db
        .prepare("SELECT status FROM pr_reviews WHERE id=?")
        .get(review) as any
    ).status,
    "awaiting_answers",
  );
  assert.equal(service.requestReview(monitor, "repo", 1), review);
  assert.equal(questions.answer(batch, ["30 seconds", "No"]).status, "queued");
  assert.throws(
    () => questions.answer(batch, ["30 seconds", "No"]),
    /уже отправлены/,
  );
  assert.deepEqual(questions.history(review)[0].answers, ["30 seconds", "No"]);
  store.db
    .prepare("UPDATE pr_reviews SET status='awaiting_answers' WHERE id=?")
    .run(review);
  const later = questions.create(review, [
    { question: "New question?", reason: "New requirement" },
  ]);
  store.db.prepare("UPDATE pull_requests SET head='changed'").run();
  assert.throws(() => questions.answer(later, ["Answer"]), /PR изменён/);
  questions.dismiss(later);
  assert.equal(
    (
      store.db
        .prepare("SELECT status FROM pr_reviews WHERE id=?")
        .get(review) as any
    ).status,
    "completed",
  );
});

test("review memory selection defaults to all scopes and preserves explicit opt-out", () => {
  assert.deepEqual(reviewOptionsSchema.parse({}).memoryScopes, ["general", "client", "project", "project_review"]);
  assert.deepEqual(reviewOptionsSchema.parse({ memoryScopes: [] }).memoryScopes, []);
  const options = reviewOptionsSchema.parse({ memoryScopes: ["project_review"], reviewerComment: "Focus on errors" });
  assert.deepEqual(reviewOptionsSchema.parse(JSON.parse(JSON.stringify(options))), options);
  assert.throws(() => reviewOptionsSchema.parse({ memoryScopes: ["unknown"] }));
});

test("retry after review error gets an isolated usage budget and runtime identity", t => {
  const store = fixture(t);
  store.set("settings", { ...store.settings(), azureUrl: "https://ado.test/org", azureProject: "P" });
  store.setSecret("azure.pat", "pat");
  store.setSecret("github.token", "token");
  const service = new PullRequests(store, { active: () => null, chat: async () => ({ body: "", requestId: "" }) });
  service.save({ ...context, repository: "repo", mode: "all", enabled: true });
  const monitor = service.monitors()[0].id;
  store.db.prepare("INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(monitor, "repo", 1, "Title", "Author", "https://ado.test/pr", "head", "target", 0, 1, "now");
  const ledger = new UsageLedger(store);
  const first = service.requestReview(monitor, "repo", 1);
  const request = ledger.begin("model", context, "pr_review");
  ledger.registerReviewRequest(first, request);
  ledger.record(request, "receipt", { inputTokens: 1000, outputTokens: 200 });
  store.db.prepare("UPDATE pr_reviews SET status='error',usage_id=? WHERE id=?").run(request, first);
  const second = service.requestReview(monitor, "repo", 1);
  assert.notEqual(second, first);
  assert.equal(ledger.reviewTokens(second), 0);
  assert.equal(ledger.reviewUsage(second).totalTokens, null);
  assert.equal(ledger.reviewUsage(first).totalTokens, 1200);
  assert.equal(service.requestReview(monitor, "repo", 1), second);
});

test("review does not call the model when source changes while preparing context", async t => {
  const store = fixture(t);
  store.set("settings", { ...store.settings(), azureUrl: "https://ado.test/org", azureProject: "P" });
  store.setSecret("azure.pat", "pat");
  store.setSecret("github.token", "token");
  let modelCalls = 0, detailCalls = 0;
  const service = new PullRequests(store, { active: () => null, chat: async () => { modelCalls++; return { body: "", requestId: "" }; } });
  service.save({ ...context, repository: "repo", mode: "all", enabled: true });
  const monitor = service.monitors()[0].id;
  store.db.prepare("INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(monitor, "repo", 1, "Title", "Author", "https://ado.test/pr", "head", "target", 0, 1, "now");
  t.mock.method(service as any, "get", async () => {
    detailCalls++;
    return { status: "active", isDraft: false, lastMergeSourceCommit: { commitId: detailCalls === 1 ? "head" : "new-head" }, lastMergeTargetCommit: { commitId: "target" } };
  });
  t.mock.method(service, "changes", async () => ({ patches: [{ path: "a.ts", patch: "diff" }], notes: [], base: "target" }) as any);
  const id = service.requestReview(monitor, "repo", 1, { readCode: false, readTickets: false });
  await service.reviewNext();
  assert.equal(detailCalls, 2);
  assert.equal(modelCalls, 0);
  assert.equal((store.db.prepare("SELECT status FROM pr_reviews WHERE id=?").get(id) as any).status, "outdated");
});

test("per-review tool limits validate without changing legacy options", () => {
  assert.equal(reviewOptionsSchema.parse({}).maxToolCalls, undefined);
  for (const maxToolCalls of [1, 1000]) {
    assert.equal(reviewOptionsSchema.parse({ maxToolCalls }).maxToolCalls, maxToolCalls);
  }
  for (const maxToolCalls of [0, -1, 1001, 1.5, "30", null]) {
    assert.throws(() => reviewOptionsSchema.parse({ maxToolCalls }));
  }
});
