import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ChatMarkdown } from "../src/ChatMarkdown.js";
import { chatCodeBranch } from "../src/chat-code-branch.js";
const base = "/code?client=C&project=P&branch=feature%2Ftest";
test("code links preserve file and range and reject unsafe paths", () => {
  const link = chatCodeBranch(base + "&path=src%2Fa.ts&line=501&endLine=505")!;
  assert.equal(link.path, "src/a.ts");
  assert.equal(link.startLine, 501);
  assert.equal(chatCodeBranch(link.href)?.endLine, 505);
  assert.equal(chatCodeBranch(base + "&path=../secret&line=1"), null);
  assert.equal(chatCodeBranch(base + "&path=a.ts&line=5&endLine=2"), null);
});
test("branch cards have copy control and code cards keep line navigation", () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ChatMarkdown, { text: `[branch](${base})\n\n[file](${base}&path=a.ts&line=2&endLine=3)` })));
  assert.match(html, /chat-code-reference/);
  assert.match(html, /Скопировать имя ветки/);
  assert.match(html, /chat-code-link/);
  assert.match(html, /a.ts:2/);
  assert.match(html, /endLine=3/);
});

test("code buttons show filename or symbol while retaining full navigation path", () => {
  const url = base + "&path=src%2Fdeep%2Fservice.ts&line=4&endLine=8";
  const render = (href: string) => renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ChatMarkdown, { text: `[ref](${href})` })));
  assert.match(render(url), /<span>service.ts:4/);
  const symbol = render(url + "&label=loadUser");
  assert.match(symbol, /<span>loadUser:4/);
  assert.match(symbol, /src\/deep\/service.ts/);
  assert.equal(chatCodeBranch(url + "&label=loadUser")?.label, "loadUser");
});
