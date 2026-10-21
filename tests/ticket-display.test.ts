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

import {
  deepReadConsent,
  DEEP_READ_WARNING,
} from "../server/ticket-display.js";

test("deep read consent requires a separate yes after the actual token warning", () => {
  const request = "Проведи глубокий анализ тикетов #42 и #43";
  assert.equal(deepReadConsent(request, []).needsConfirmation, true);
  assert.equal(deepReadConsent(request, []).confirmed, false);
  const history = [
    { role: "user", body: request },
    { role: "assistant", body: DEEP_READ_WARNING },
  ];
  for (const reply of ["Да", "да, давай", "Продолжай", "yes", "Давай, погнали", "Да похуй", "пофиг, читай", "окей"]) {
    assert.equal(deepReadConsent(reply, history).confirmed, true);
    assert.equal(deepReadConsent(reply, history).request, request);
  }
  for (const reply of [
    "Нет",
    "Не надо",
    "Да, но другие тикеты",
    "Добавь тег UI",
  ])
    assert.equal(deepReadConsent(reply, history).confirmed, false);
  assert.equal(
    deepReadConsent("Да", [
      { role: "user", body: request },
      { role: "assistant", body: "Выполнить эти изменения?" },
    ]).confirmed,
    false,
  );
  assert.equal(
    deepReadConsent("Да", [
      ...history,
      { role: "user", body: "Да" },
      { role: "assistant", body: "Готово" },
    ]).confirmed,
    false,
  );
  assert.equal(
    deepReadConsent("Да", [
      { role: "user", body: "Добавь тег UI" },
      { role: "assistant", body: DEEP_READ_WARNING },
    ]).confirmed,
    false,
  );
  // Current checkbox selection cannot silently expand the original request.
  assert.equal(
    deepReadConsent(
      "Да\n\nВыбранные пользователем тикеты в таблице: #99",
      history,
    ).request,
    request,
  );
});

import { singleTicketTarget } from "../server/ticket-display.js";
test("single-ticket exception excludes counts and multi-ticket selections", () => {
  assert.equal(singleTicketTarget("Что думаешь о тикете #42?"), 42);
  assert.equal(singleTicketTarget("Покажи описание тикета 42"), 42);
  assert.equal(singleTicketTarget("Покажи описание #42 и 43"), undefined);
  assert.equal(singleTicketTarget("Проанализируй все 23 тикета"), undefined);
  assert.equal(
    singleTicketTarget(
      "Проанализируй все тикеты\n\nВыбранные пользователем тикеты в таблице: #42",
    ),
    undefined,
  );
  assert.equal(
    singleTicketTarget(
      "Покажи описание выбранного тикета\n\nВыбранные пользователем тикеты в таблице: #42",
    ),
    42,
  );
  assert.equal(
    singleTicketTarget("Что думаешь об этом тикете?", [
      { role: "user", body: "Какой статус тикета #42?" },
      { role: "assistant", body: "Active" },
    ]),
    42,
  );
});


test("token warning may be phrased conversationally", () => {
  const history = [
    { role: "user", body: "Проведи глубокий анализ тикетов #42 и #43" },
    { role: "assistant", body: "Чтение описаний может потратить много токенов. Продолжить?" },
  ];
  assert.equal(deepReadConsent("Да похуй", history).confirmed, true);
  for (const reply of ["Нет, не читай", "Да, но другие тикеты", "А сколько токенов?", "Не продолжай"])
    assert.equal(deepReadConsent(reply, history).confirmed, false);
});


test("cached description search does not require full-read consent", async () => {
  const { asksCachedContentSearch } = await import("../server/ticket-display.js");
  assert.equal(asksCachedContentSearch("Найди в описаниях слово протокол"), true);
  assert.equal(asksCachedContentSearch("Проведи глубокий анализ и найди в описаниях ошибки"), false);
});
