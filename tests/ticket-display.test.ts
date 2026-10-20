import test from "node:test";
import assert from "node:assert/strict";
import { wantsTicketDetails } from "../server/ticket-display.js";

test("full ticket display requires an explicit request, not a list or status command", () => {
  for (const prompt of [
    "Покажи тикет 123456",
    "Покажи мне деталку",
    "Открой карточку #42",
    "Покажи описание тикета 42",
    "Show ticket 42",
  ])
    assert.ok(wantsTicketDetails(prompt), prompt);
  for (const prompt of [
    "Переведи тикет 42 в RFT",
    "Какой статус тикета 42?",
    "Покажи тикеты в Resolved",
    "Покажи список тикетов",
    "Не показывай карточку тикета 42",
    "123456",
    "Покажи название тикета 42",
  ])
    assert.ok(!wantsTicketDetails(prompt), prompt);
});
