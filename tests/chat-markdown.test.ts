import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "../src/ChatMarkdown.js";

const render = (text: string) =>
  renderToStaticMarkup(createElement(ChatMarkdown, { text }));

test("chat renders emphasis, lists, code, quotes and GFM tables", () => {
  const html = render(
    "**Bold** and *italic* and ***both***\n\n- First\n- Second\n\n> Quote\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\n| A | B |\n| - | - |\n| 1 | 2 |",
  );
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<em><strong>both<\/strong><\/em>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<blockquote class="chat-quote-card">/);
  assert.match(html, /<pre><code/);
  assert.match(html, /<table>/);
});
test("chat ignores raw HTML, blocks executable links and loads image previews lazily", () => {
  const html = render(
    "<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n[good](https://example.com)\n\n![preview](https://example.com/image.png)",
  );
  assert.doesNotMatch(html, /<script|javascript:/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /noopener noreferrer/);
});

test("PR images use the local preview route, including relative Markdown images", () => {
  const html = renderToStaticMarkup(
    createElement(ChatMarkdown, {
      text: "![Screenshot](/org/image.png)",
      images: [{ source: "/org/image.png", preview: "/api/pr/image?number=1" }],
    }),
  );
  assert.match(html, /<img/);
  assert.match(html, /src="\/api\/pr\/image\?number=1"/);
  assert.match(html, /loading="lazy"/);
  assert.doesNotMatch(html, /src="\/org\/image.png"/);
});

test("ticket navigation is an internal router link and retains its Azure source", async () => {
  const { MemoryRouter } = await import("react-router-dom");
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      {},
      createElement(ChatMarkdown, {
        text: "[Перейти к тикету #42](/tickets?id=42&source=https%3A%2F%2Fado.test%2Forg%7CP)",
      }),
    ),
  );
  assert.match(html, /class="chat-ticket-link"/);
  assert.match(html, /href="\/tickets\?id=42&amp;source=/);
  assert.doesNotMatch(html, /target="_blank"/);
});

test("Azure references open locally only for the current source and include copy actions", () => {
  const html = renderToStaticMarkup(createElement(ChatMarkdown, {
    azureSource: "https://dev.azure.com/org|Project",
    text: "[Ticket](https://dev.azure.com/org/Project/_workitems/edit/42) [Other](https://dev.azure.com/other/Project/_workitems/edit/42)",
  }));
  assert.match(html, /href="\/tickets\?id=42&amp;source=/);
  assert.match(html, /href="https:\/\/dev.azure.com\/other\/Project\/_workitems\/edit\/42"/);
  assert.equal((html.match(/class="chat-link-copy"/g) || []).length, 2);
});

test("PR cards render compact metadata and source-qualified navigation", async () => {
  const { MemoryRouter } = await import("react-router-dom");
  const params = new URLSearchParams({ card: "pr", monitor: "team", repo: "repo", number: "42", title: "Fix layout", author: "Alex", createdAt: "2026-10-22T10:00:00Z" });
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ChatMarkdown, { text: `[PR](/pull-requests?${params})` })));
  assert.match(html, /class="chat-pr-card"/);
  assert.match(html, /Fix layout/);
  assert.match(html, /Alex/);
  assert.match(html, /22\.10\.2026/);
  assert.match(html, /href="\/pull-requests\?monitor=team&amp;repo=repo&amp;number=42"/);
  assert.doesNotMatch(html, /chat-link-copy/);
});
