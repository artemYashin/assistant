import test from "node:test";
import assert from "node:assert/strict";
import { ReviewProgress, reviewToolLabels, reviewBaseTools, reviewCodeTools, reviewTicketTools } from "../server/review-progress.js";

test("review progress tracks concurrent tools, failures and isolated review lifecycles", () => {
  const progress = new ReviewProgress();
  progress.prepare("one", "Читаю связанные тикеты и заметки");
  assert.equal(progress.text("one", "running"), "Читаю связанные тикеты и заметки");
  progress.update("one", {stage: "tool", toolId: "code", name: "code_read_file", status: "running"});
  progress.update("one", {stage: "tool", toolId: "memory", name: "read_memory", status: "running"});
  assert.equal(progress.text("one", "running"), "Читаю память");
  assert.equal(progress.text("two", "running"), "Готовлю контекст ревью");
  progress.update("one", {stage: "tool", toolId: "memory", name: "read_memory", status: "error"});
  assert.equal(progress.text("one", "running"), "Читаю код");
  progress.update("one", {stage: "tool", toolId: "code", name: "code_read_file", status: "completed"});
  assert.equal(progress.text("one", "running"), "Анализирую изменения и готовлю ответ");
  for (const status of ["completed", "error", "interrupted", "outdated", "cancelled"])
    assert.equal(progress.text("one", status), null);
  assert.equal(progress.text("one", "awaiting_answers"), "Ожидаю ваших ответов");
  assert.equal(progress.text("one", "queued"), "Ожидаю запуска ревью");
  assert.equal(progress.text("one", "preparing_git", "one"), "Подготавливаю локальную ветку Git");
  progress.clear("one");
  assert.equal(progress.text("one", "running"), "Готовлю контекст ревью");
});

test("every permitted review tool has a readable activity label", () => {
  const progress = new ReviewProgress();
  for (const name of [...reviewBaseTools, ...reviewCodeTools, ...reviewTicketTools]) {
    progress.update("review", {stage: "tool", toolId: name, name, status: "running"});
    assert.equal(progress.text("review", "running"), reviewToolLabels[name]);
    assert.match(reviewToolLabels[name], /[А-Яа-я]/);
    progress.update("review", {stage: "tool", toolId: name, name, status: "completed"});
  }
});


test("queued reviews distinguish another active review from actual Git preparation", () => {
  const progress = new ReviewProgress();
  for (const status of ["preparing_git", "queued"]) {
    assert.equal(progress.text("second", status, "first"), "Ожидание завершения другого ревью");
    assert.equal(progress.text("second", status, null), "Ожидаю запуска ревью");
  }
  assert.equal(progress.text("second", "preparing_git", "second"), "Подготавливаю локальную ветку Git");
  assert.equal(progress.text("second", "interrupted", "first"), null);
  assert.equal(progress.text("second", "awaiting_answers", "first"), "Ожидаю ваших ответов");
});
