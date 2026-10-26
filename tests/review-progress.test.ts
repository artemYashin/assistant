import test from "node:test";
import assert from "node:assert/strict";
import {
  ReviewProgress,
  reviewBaseTools,
  reviewCodeTools,
  reviewTicketTools,
} from "../services/backend/src/review-progress.js";

test("review progress tracks concurrent tools, failures and isolated review lifecycles", () => {
  const progress = new ReviewProgress();
  progress.prepare("one", "Читаю связанные тикеты и заметки");
  assert.equal(progress.text("one", "running"), "Читаю связанные тикеты и заметки");
  progress.update("one", {
    stage: "tool",
    toolId: "code",
    name: "code_read_file",
    status: "running",
  });
  progress.update("one", {
    stage: "tool",
    toolId: "memory",
    name: "read_memory",
    status: "running",
  });
  assert.equal(progress.text("one", "running"), "Анализирую изменения");
  assert.equal(progress.text("two", "running"), "Анализирую изменения");
  progress.update("one", { stage: "tool", toolId: "memory", name: "read_memory", status: "error" });
  assert.equal(progress.text("one", "running"), "Анализирую изменения");
  progress.update("one", {
    stage: "tool",
    toolId: "code",
    name: "code_read_file",
    status: "completed",
  });
  assert.equal(progress.text("one", "running"), "Анализирую изменения");
  for (const status of ["completed", "error", "interrupted", "outdated", "cancelled"])
    assert.equal(progress.text("one", status), null);
  assert.equal(progress.text("one", "awaiting_answers"), "Ожидаю ваших ответов");
  assert.equal(progress.text("one", "queued"), "Ожидаю запуска ревью");
  assert.equal(progress.text("one", "preparing_git", "one"), "Подготавливаю локальную ветку Git");
  progress.clear("one");
  assert.equal(progress.text("one", "running"), "Анализирую изменения");
});

test("all review tools use one analysis status", () => {
  const progress = new ReviewProgress();
  for (const name of [...reviewBaseTools, ...reviewCodeTools, ...reviewTicketTools]) {
    progress.update("review", { stage: "tool", toolId: name, name, status: "running" });
    assert.equal(progress.text("review", "running"), "Анализирую изменения");
    progress.update("review", { stage: "tool", toolId: name, name, status: "completed" });
  }
});

test("queued reviews distinguish another active review from actual Git preparation", () => {
  const progress = new ReviewProgress();
  for (const status of ["preparing_git", "queued"]) {
    assert.equal(progress.text("second", status, "first"), "Ожидание завершения другого ревью");
    assert.equal(progress.text("second", status, null), "Ожидаю запуска ревью");
  }
  assert.equal(
    progress.text("second", "preparing_git", "second"),
    "Подготавливаю локальную ветку Git",
  );
  assert.equal(progress.text("second", "interrupted", "first"), null);
  assert.equal(progress.text("second", "awaiting_answers", "first"), "Ожидаю ваших ответов");
});

test("answer generation follows text events and returns to analysis for further tools", () => {
  const progress = new ReviewProgress();
  progress.update("one", { stage: "text", messageId: "a", text: " " });
  assert.equal(progress.text("one", "running"), "Анализирую изменения");
  progress.update("one", { stage: "text", messageId: "a", text: "Результат" });
  assert.equal(progress.text("one", "running"), "Готовлю результат");
  progress.update("one", {
    stage: "tool",
    toolId: "code",
    name: "code_read_file",
    status: "running",
  });
  progress.update("one", { stage: "text", messageId: "b", text: "Промежуточный текст" });
  assert.equal(progress.text("one", "running"), "Анализирую изменения");
  progress.update("one", {
    stage: "tool",
    toolId: "code",
    name: "code_read_file",
    status: "completed",
  });
  assert.equal(progress.text("one", "running"), "Анализирую изменения");
  progress.update("one", { stage: "text", messageId: "final", text: "Итог" });
  assert.equal(progress.text("one", "running"), "Готовлю результат");
  assert.equal(progress.text("two", "running"), "Анализирую изменения");
  assert.equal(progress.text("one", "completed"), null);
});
