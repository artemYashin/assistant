import test from "node:test";
import assert from "node:assert/strict";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";
import { remarkDescriptionBreaks } from "../services/frontend/src/features/render-content/index.js";

const parse = (text: string) => {
  const processor = unified().use(remarkParse).use(remarkDescriptionBreaks);
  return processor.runSync(processor.parse(text)) as Root;
};
test("PR description preserves newlines and explicit breaks after images", () => {
  for (const separator of ["\n", "\r\n", "<br>", "<br />"]) {
    const root = parse(`![Screenshot](https://example.test/image.png)${separator}Text`);
    const paragraph = root.children[0];
    assert.equal(paragraph.type, "paragraph");
    if (paragraph.type !== "paragraph") throw new Error("Missing paragraph");
    assert.deepEqual(
      paragraph.children.map((c) => c.type),
      ["image", "break", "text"],
    );
  }
});
test("PR description keeps intentional inline images, code and HTML safety", () => {
  const root = parse(
    "![Image](https://example.test/a.png) inline\n\n`a <br> b`\n\n```\na\nb\n```\n\n<script>alert(1)</script>",
  );
  const paragraph = root.children[0];
  assert.equal(paragraph.type, "paragraph");
  if (paragraph.type === "paragraph")
    assert.deepEqual(
      paragraph.children.map((c) => c.type),
      ["image", "text"],
    );
  assert.equal(root.children[2].type, "code");
  assert.equal((root.children[2] as any).value, "a\nb");
  assert.equal(root.children[3].type, "html");
});
