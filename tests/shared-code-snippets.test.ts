import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryMarkdown } from "../src/features/render-content/index.js";
import { highlightSnippet } from "../src/entities/repository/highlight/index.js";
import { TicketRichText } from "../src/features/render-content/index.js";

test("memory snippets preserve code text and expose copy control", () => {
  const html = renderToStaticMarkup(createElement(MemoryMarkdown, { body: '```html\n<div>example</div>\n```\n\nInline `value`.' }));
  assert.match(html, /chat-code-snippet/);
  assert.match(html, /Скопировать код/);
  assert.match(html.replace(/<\/?span[^>]*>/g, ""), /&lt;div&gt;example&lt;\/div&gt;/);
  assert.match(html, /<code>value<\/code>/);
});
test("ticket Markdown fences with HTML code are not mistaken for rich HTML", () => {
  const html = renderToStaticMarkup(createElement(TicketRichText, { value: '```html\n<div>example</div>\n```', card: {}, reference: "ticket" }));
  assert.match(html, /chat-code-snippet/);
  assert.match(html.replace(/<\/?span[^>]*>/g, ""), /&lt;div&gt;example&lt;\/div&gt;/);
  assert.match(html, /Скопировать код/);
});

test("snippets highlight declared languages and autodetect while preserving multiline code", () => {
  const code = 'const greeting = "hello";\n/* first\nsecond */\nconsole.log(greeting);';
  for (const language of ["js", "javascript", ""]) {
    const lines = highlightSnippet(code, language);
    assert.equal(lines.map(line => line.map(token => token.text).join("")).join("\n"), code);
    assert.ok(lines.flat().some(token => language ? token.className.includes("hljs-keyword") : !!token.className));
  }
  assert.ok(highlightSnippet(code, "js")[2].some(token => token.className.includes("hljs-comment")));
  for (const language of ["plaintext", "made-up-language"]) {
    assert.ok(highlightSnippet(code, language).flat().every(token => !token.className));
  }
  const html = renderToStaticMarkup(createElement(MemoryMarkdown, { body: '```js\nconst value = 42;\n```' }));
  assert.match(html, /hljs-keyword/);
  assert.match(html, /hljs-number/);
});
