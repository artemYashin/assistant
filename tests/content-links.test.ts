import test from "node:test";
import assert from "node:assert/strict";
import {
  contentLinks,
  contentLinkGroups,
} from "../services/frontend/src/features/render-content/lib/content-links.js";

const base = "https://dev.azure.com/example";
test("ticket links parse Markdown, references and bare URLs, deduplicating across sections", () => {
  assert.deepEqual(
    contentLinks(
      [
        {
          value: "https://figma.com/design/abc\n\n[Макет **экрана**](https://figma.com/design/abc)",
          markdown: true,
        },
        { value: "[Репозиторий][repo]\n\n[repo]: https://github.com/example/repo", markdown: true },
        {
          value: "[Макет](https://figma.com/design/abc) и https://example.test/spec?q=1#part",
          markdown: true,
        },
      ],
      base,
    ),
    [
      { url: "https://figma.com/design/abc", label: "Макет экрана" },
      { url: "https://github.com/example/repo", label: "Репозиторий" },
      { url: "https://example.test/spec?q=1#part", label: "https://example.test/spec?q=1#part" },
    ],
  );
});
test("ticket links exclude images, code, unsafe schemes and local attachment proxies", () => {
  const value = [
    "![Screenshot](https://example.test/image.png)",
    "`https://example.test/code`",
    '```html\n<a href="https://example.test/sample">Sample</a>\n```',
    "[Unsafe](javascript:alert) [Local](blob:local) [Anchor](#section)",
    "[Proxy](/api/ticket-cards/ref/attachments/image)",
    "[Secrets](https://user:password@example.test/)",
    "[Spec](_workitems/edit/42)",
    "[Screenshot link](https://example.test/image.png)",
  ].join("\n\n");
  assert.deepEqual(contentLinks([{ value, markdown: true }, { value: null }], base), [
    { url: base + "/_workitems/edit/42", label: "Spec" },
    { url: "https://example.test/image.png", label: "Screenshot link" },
  ]);
});

test("Markdown autolinks are not mistaken for HTML tags", () => {
  assert.deepEqual(contentLinks([{ value: "<https://example.test/spec>" }], base), [
    { url: "https://example.test/spec", label: "https://example.test/spec" },
  ]);
});

test("deduplicated links keep the source and quote of the chosen caption", () => {
  assert.deepEqual(
    contentLinks(
      [
        { value: "https://example.test/spec", source: "description" },
        { value: "[Требования](https://example.test/spec)", source: "comment:15" },
        { value: "[Повтор](https://example.test/spec)", source: "comment:16" },
      ],
      base,
    ),
    [
      {
        url: "https://example.test/spec",
        label: "Требования",
        source: "comment:15",
        quote: "Требования",
      },
    ],
  );
});

test("link groups preserve section and occurrence order, including shared URLs in different sections", () => {
  const groups = contentLinkGroups(
    [
      {
        source: "description",
        title: "Описание",
        value:
          "[First](https://example.test/shared) [Second](https://example.test/second) [Again](https://example.test/shared)",
      },
      { source: "repro", title: "Шаги воспроизведения", value: "No links" },
      {
        source: "criteria",
        title: "Критерии приёмки",
        value: "[Shared criterion](https://example.test/shared)",
      },
      { source: "comment:1", title: "Комментарий 1", value: "https://example.test/comment" },
    ],
    base,
  );
  assert.deepEqual(
    groups.map((group) => group.source),
    ["description", "criteria", "comment:1"],
  );
  assert.deepEqual(
    groups[0].links.map((link) => link.label),
    ["First", "Second"],
  );
  assert.equal(groups[1].links[0].url, groups[0].links[0].url);
  assert.equal(groups[1].links[0].source, "criteria");
});
