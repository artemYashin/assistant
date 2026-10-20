import test from "node:test";
import assert from "node:assert/strict";
import { metadataContextRequest } from "../server/metadata-context.js";
const history = [
  { role: "user", body: "Добавь тег UI тикетам Internal Sites" },
  { role: "assistant", body: "Добавить ко всем 23 тикетам или только к #42?" },
];
test("scope clarification retains the user's metadata request, never the assistant's suggested action", () => {
  const result = metadataContextRequest("Ко всем 23, кроме #42", history);
  assert.equal(result.contextual, true);
  assert.match(result.prompt, /Добавь тег UI/);
  assert.match(result.prompt, /кроме #42/);
  assert.doesNotMatch(result.prompt, /или только/);
  for (const reply of ["Нет", "Отмена", "Спасибо", "Какие там статусы?"]) {
    assert.equal(metadataContextRequest(reply, history).contextual, false);
  }
  assert.equal(
    metadataContextRequest("Да", [
      { role: "user", body: "Покажи тикеты" },
      { role: "assistant", body: "Добавить тег UI?" },
    ]).contextual,
    false,
  );
  assert.equal(metadataContextRequest("Да", []).contextual, false);
});

import { confirmedChatRequest } from "../server/metadata-context.js";

test("text approval continues the immediately preceding request only", () => {
  const history = [
    { role: "user", body: "Переведи #42 и #43 в RFT" },
    {
      role: "assistant",
      body: "#42 — Full title\n#43 — Another title\nВыполнить эти изменения? Ответьте „да, делай“",
    },
  ];
  const result = confirmedChatRequest("Да, делай", history);
  assert.equal(result.contextual, true);
  assert.match(result.prompt, /Переведи #42 и #43 в RFT/);
  for (const reply of ["Нет", "Да, но только #42", "Добавь тег X"])
    assert.equal(confirmedChatRequest(reply, history).contextual, false);
  assert.equal(
    confirmedChatRequest("Да", [{ role: "assistant", body: "Помочь ещё?" }])
      .contextual,
    false,
  );
});

test("text approval preserves original metadata intent through a clarification", () => {
  const result = confirmedChatRequest("да, давай делай", [
    { role: "user", body: "Добавь тег UI всем тикетам" },
    { role: "assistant", body: "Всем 23?" },
    { role: "user", body: "Ко всем 23, кроме #42" },
    { role: "assistant", body: "Добавлю тег UI. Выполнить эти изменения?" },
  ]);
  assert.equal(result.contextual, true);
  assert.match(result.prompt, /Добавь тег UI/);
  assert.match(result.prompt, /кроме #42/);
});

test("metadata confirmation retains exclusions across several clarification turns", () => {
  const result = metadataContextRequest("Да, давай", [
    { role: "user", body: "Добавь тег Inside 2 всем тикетам" },
    { role: "assistant", body: "Всем из списка?" },
    { role: "user", body: "Всем, кроме #42" },
    { role: "assistant", body: "Добавлю Inside 2 к остальным. Выполнить?" },
  ]);
  assert.equal(result.contextual, true);
  assert.match(result.prompt, /Inside 2/);
  assert.match(result.prompt, /кроме #42/);
});

test("status confirmation accepts natural question variants and carries displayed IDs", () => {
  for (const question of ["Выполнить изменение?", "Выполнить изменения?", "Выполнить действие?", "Применить изменения?"]) {
    const result = confirmedChatRequest("Да, давай", [
      {role: "user", body: "Переведи эти тикеты в RFT"},
      {role: "assistant", body: `#42 — First; #43 — Second. Ready for Testing. ${question}`},
    ]);
    assert.equal(result.contextual, true);
    assert.match(result.prompt, /Переведи эти тикеты в RFT/);
    assert.match(result.prompt, /#42, #43/);
  }
  assert.equal(confirmedChatRequest("Да, давай", [
    {role: "user", body: "Переведи эти тикеты в RFT"},
    {role: "assistant", body: "Хочешь посмотреть другие тикеты?"},
  ]).contextual, false);
});

test("status approval survives clarification, Markdown and local links without hash IDs", () => {
  const result = confirmedChatRequest("Да, давай", [
    {role: "user", body: "Давай поменяем статус тикетов с тегом Inside 2"},
    {role: "assistant", body: "В какой статус перевести?"},
    {role: "user", body: "RFT"},
    {role: "assistant", body: "42 — First [Перейти](/tickets?id=42&source=example)\n43 — Second [Перейти](/tickets?source=example&id=43)\nГотов перевести в Ready for Testing. **Выполнить изменения для этих тикетов?**"},
  ]);
  assert.equal(result.contextual, true);
  assert.match(result.prompt, /Давай поменяем статус/);
  assert.match(result.prompt, /Уточнение пользователя: RFT/);
  assert.match(result.prompt, /#42, #43/);
});

test("natural short approvals preserve the plan, but changed scope and refusals do not", () => {
  const history = [
    {role: "user", body: "Переведи #42 и #43 в RFT"},
    {role: "assistant", body: "#42 — First; #43 — Second. Выполнить изменения?"},
  ];
  for (const reply of ["Давай, погнали", "Поехали!", "Ок, делай", "Да, конечно, выполняй", "Ага, давай", "Хорошо, сделай, пожалуйста", "Подтверждаю", "Okay, go ahead", "Yes, do it please"]) {
    const result = confirmedChatRequest(reply, history);
    assert.equal(result.contextual, true, reply);
    assert.match(result.prompt, /Переведи #42 и #43 в RFT/);
    assert.equal(confirmedChatRequest(reply, []).contextual, false);
  }
  for (const reply of ["Давай, но только #42", "Да, кроме #43", "Да, но в Active", "Не надо", "Нет, погнали дальше", "Давай погнали?", "Погнали посмотреть список", "Пожалуйста", "Да, стоп"]) {
    assert.equal(confirmedChatRequest(reply, history).contextual, false, reply);
  }
});
