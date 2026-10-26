import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TicketDate } from "../services/frontend/src/entities/ticket/index.js";
test("table dates render separate date/time and retain full machine readable instant", () => {
  const value = "2026-10-25T14:05:12Z";
  const html = renderToStaticMarkup(createElement(TicketDate, { value }));
  assert.match(html, /dateTime="2026-10-25T14:05:12.000Z"/);
  assert.match(html, /<span>25\.10\.26<\/span><small>\d{2}:05<\/small>/);
});
test("missing and malformed dates render a dash; epoch remains a valid date", () => {
  for (const value of [null, undefined, "", "invalid"])
    assert.equal(renderToStaticMarkup(createElement(TicketDate, { value })), "—");
  assert.match(
    renderToStaticMarkup(createElement(TicketDate, { value: 0 })),
    /1970-01-01T00:00:00.000Z/,
  );
});
