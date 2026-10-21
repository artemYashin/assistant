import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryMarkdown } from "../src/MemoryMarkdown.js";
import { TicketRichText } from "../src/TicketRichText.js";

test("memory snippets preserve code text and expose copy control", () => {
  const html = renderToStaticMarkup(createElement(MemoryMarkdown, { body: '```html\n<div>example</div>\n```\n\nInline `value`.' }));
  assert.match(html, /chat-code-snippet/);
  assert.match(html, /Скопировать код/);
  assert.match(html, /&lt;div&gt;example&lt;\/div&gt;/);
  assert.match(html, /<code>value<\/code>/);
});
test("ticket Markdown fences with HTML code are not mistaken for rich HTML", () => {
  const html = renderToStaticMarkup(createElement(TicketRichText, { value: '```html\n<div>example</div>\n```', card: {}, reference: "ticket" }));
  assert.match(html, /chat-code-snippet/);
  assert.match(html, /&lt;div&gt;example&lt;\/div&gt;/);
  assert.match(html, /Скопировать код/);
});
