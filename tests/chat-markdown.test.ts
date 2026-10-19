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
  assert.match(html, /<blockquote>/);
  assert.match(html, /<pre><code/);
  assert.match(html, /<table>/);
});
test("chat ignores raw HTML, blocks executable links and does not auto-fetch images", () => {
  const html = render(
    "<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n[good](https://example.com)\n\n![preview](https://example.com/image.png)",
  );
  assert.doesNotMatch(html, /<script|javascript:|<img/);
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
