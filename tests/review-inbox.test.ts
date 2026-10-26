import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { ReviewQuestions } from "../services/backend/src/review-questions.js";

test("inbox removal upgrades populated storage, preserves answers, finishes only waiting reviews and persists on restart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-inbox-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.db
    .prepare(
      "INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled) VALUES ('m','c','p','https://ado.test','P','all',1)",
    )
    .run();
  const questions = new ReviewQuestions(store);
  const batches: Record<string, string> = {};
  for (const [index, status] of ["awaiting_answers", "running", "completed", "queued"].entries()) {
    store.db
      .prepare(
        "INSERT INTO pr_reviews(id,monitor,repo,number,head,target,status,summary,created_at) VALUES (?,'m','repo',?,'head','target',?,'Saved report','now')",
      )
      .run(status, index + 1, status);
    batches[status] = questions.create(status, [{ question: "Question", reason: "Reason" }]);
  }
  store.db
    .prepare(
      "UPDATE pr_question_batches SET status='answered',answers='[\"Saved answer\"]' WHERE review_id='completed'",
    )
    .run();
  const before = questions.history("completed");
  store.db.exec("DROP TABLE pr_question_inbox_hidden"); // Representative installation before this upgrade.
  store.close();
  store = new Store(dir);
  let service = new ReviewQuestions(store);
  assert.equal(service.list().length, 4);
  service.remove(batches.completed);
  assert.deepEqual(service.history("completed"), before);
  store.db.prepare("UPDATE pr_reviews SET status='running' WHERE id='running'").run();
  service.remove(batches.running);
  assert.equal(
    (store.db.prepare("SELECT status FROM pr_reviews WHERE id='running'").get() as any).status,
    "running",
  );
  // A failed hide must roll back both the question dismissal and the review completion.
  store.db.exec(
    "CREATE TRIGGER fail_hide BEFORE INSERT ON pr_question_inbox_hidden BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  );
  assert.throws(() => service.remove(batches.awaiting_answers), /fixture failure/);
  assert.equal(
    (store.db.prepare("SELECT status FROM pr_reviews WHERE id='awaiting_answers'").get() as any)
      .status,
    "awaiting_answers",
  );
  store.db.exec("DROP TRIGGER fail_hide");
  service.remove(batches.awaiting_answers);
  const report = store.db
    .prepare("SELECT status,summary FROM pr_reviews WHERE id='awaiting_answers'")
    .get() as any;
  assert.equal(report.status, "completed");
  assert.match(report.summary, /Saved report/);
  assert.match(report.summary, /без ответов/);
  service.remove(batches.awaiting_answers);
  assert.deepEqual(
    store.db.prepare("SELECT status,summary FROM pr_reviews WHERE id='awaiting_answers'").get(),
    report,
  );
  assert.throws(() => service.answer(batches.running, ["Late answer"]), /уже отправлены/);
  assert.throws(() => service.remove("unknown"), /не найдены/);
  for (let i = 0; i < 2; i++) {
    store.close();
    store = new Store(dir);
    service = new ReviewQuestions(store);
    assert.deepEqual(
      service.list().map((row: any) => row.id),
      [batches.queued],
    );
    assert.deepEqual(service.history("completed"), before);
  }
  store.db.prepare("DELETE FROM pr_question_batches WHERE id=?").run(batches.completed);
  assert.equal(
    store.db
      .prepare("SELECT 1 FROM pr_question_inbox_hidden WHERE batch_id=?")
      .get(batches.completed),
    undefined,
  );
});
