import test from "node:test";
import assert from "node:assert/strict";
import { groupChatHistory } from "../services/frontend/src/entities/chat/index.js";
test("history groups by local calendar days with disjoint date ranges", () => {
  const now = new Date(2026, 9, 22, 1);
  const row = (id: string, day: number, hour = 12) => ({
    id,
    updated_at: new Date(2026, 9, day, hour).toISOString(),
  });
  const result = groupChatHistory(
    [
      row("older", 14),
      row("today", 22, 0),
      row("week", 15),
      row("yesterday", 21, 23),
      row("recent", 20),
    ],
    now,
  );
  assert.deepEqual(
    result.map((g) => [g.label, g.sessions.map((s) => s.id)]),
    [
      ["Сегодня", ["today"]],
      ["Вчера", ["yesterday"]],
      ["Последняя неделя", ["recent", "week"]],
      ["Ранее", ["older"]],
    ],
  );
  assert.deepEqual(groupChatHistory([], now), []);
});
