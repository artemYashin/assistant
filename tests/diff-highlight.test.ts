import test from "node:test";
import assert from "node:assert/strict";
import { createTwoFilesPatch } from "diff";
import { splitDiff } from "../src/entities/repository/index.js";
import { diffLanguage, validDiffLanguage } from "../src/entities/repository/index.js";
import { highlightDiff, highlightLines, highlightSnippet } from "../src/entities/repository/highlight/index.js";

test("diff language detects file extensions and safely restores stored choices", () => {
  assert.equal(diffLanguage("/src/Page.TSX"), "tsx");
  assert.equal(diffLanguage("/Program.cs"), "csharp");
  assert.equal(diffLanguage("/a.yaml"), "yaml");
  assert.equal(diffLanguage("/unknown.file"), "plaintext");
  assert.equal(validDiffLanguage("javascript"), "javascript");
  assert.equal(validDiffLanguage("plaintext"), "plaintext");
  assert.equal(validDiffLanguage("bogus"), "auto");
  assert.equal(validDiffLanguage(null), "auto");
});

test("highlight preserves exact code and multiline comment scopes without injecting HTML", () => {
  const code =
    '/* first\nsecond */\nconst text = "<img src=x onerror=alert(1)>";\n';
  const lines = highlightLines(code, "typescript");
  assert.equal(
    lines.map((line) => line.map((t) => t.text).join("")).join("\n"),
    code,
  );
  assert.ok(lines[0].some((t) => t.className.includes("hljs-comment")));
  assert.ok(lines[1].some((t) => t.className.includes("hljs-comment")));
  assert.ok(lines[2].some((t) => t.className.includes("hljs-keyword")));
  assert.ok(lines[2].some((t) => t.text.includes("<img")));
});

test("diff highlights each side without changing original line numbers or text", () => {
  const [file] = splitDiff([
    createTwoFilesPatch(
      "/a.ts",
      "/a.ts",
      "/* old\ncomment */\nconst x = 1;\n",
      "/* new\ncomment */\nconst x = 2;\nconst y = true;\n",
    ),
  ]);
  const result = highlightDiff(file, "typescript");
  for (const side of ["left", "right"] as const) {
    for (const row of file.hunks.flatMap((h) => h.rows)) {
      const line = row[side];
      if (line)
        assert.equal(
          result[side][line.number].map((t) => t.text).join(""),
          line.text,
        );
    }
  }
  assert.ok(result.right[2].some((t) => t.className.includes("hljs-comment")));
  assert.equal(result.left[4], undefined);
  assert.deepEqual(highlightDiff(file, "plaintext"), { left: {}, right: {} });
  assert.deepEqual(highlightDiff(file, "unknown"), { left: {}, right: {} });
});

test("oversized hunks fall back to plain code", () => {
  const [file] = splitDiff([
    createTwoFilesPatch("/a.ts", "/a.ts", "", "x".repeat(130000)),
  ]);
  assert.deepEqual(highlightDiff(file, "typescript"), { left: {}, right: {} });
});

test("TSX and JSX highlight components, props and expressions without leaking tag scope", () => {
  const code = [
    "const View = <T,>(props: { value: T }) => (",
    "  <>",
    '    <UI.Panel title="Hello" count={2} onClick={() => { return true; }}>',
    "      {items.map(item => <Button key={item.id}>{item.name}</Button>)}",
    "      {/* multiline",
    "          comment */}",
    "    </UI.Panel>",
    "  </>",
    ");",
  ].join("\n");
  for (const language of ["tsx", "jsx"]) {
    const lines = highlightLines(code, language);
    assert.equal(
      lines.map((line) => line.map((t) => t.text).join("")).join("\n"),
      code,
    );
    const tokens = lines.flat();
    assert.ok(
      tokens.some((t) => t.text === "title" && t.className === "hljs-attr"),
    );
    assert.ok(
      tokens.some(
        (t) => t.text.includes("Hello") && t.className === "hljs-string",
      ),
    );
    assert.ok(
      tokens.some((t) => t.text === "2" && t.className === "hljs-number"),
    );
    assert.ok(
      tokens.some((t) => t.text === "return" && t.className === "hljs-keyword"),
    );
    assert.ok(
      tokens.some(
        (t) => t.text === "Button" && /hljs-(tag|type)/.test(t.className),
      ),
    );
    assert.ok(lines[5].some((t) => t.className === "hljs-comment"));
  }
  assert.equal(diffLanguage("component.jsx"), "jsx");
  assert.equal(validDiffLanguage("tsx"), "tsx");
  assert.equal(validDiffLanguage("jsx"), "jsx");
});

test("XML nested attributes retain their own colour and TSX diff fragments keep line mapping", () => {
  const tokens = highlightLines('<div class="hello">text</div>', "xml").flat();
  assert.ok(
    tokens.some((t) => t.text === "class" && t.className === "hljs-attr"),
  );
  assert.ok(
    tokens.some(
      (t) => t.text.includes("hello") && t.className === "hljs-string",
    ),
  );
  const [file] = splitDiff([
    createTwoFilesPatch(
      "/a.tsx",
      "/a.tsx",
      "<Panel size={1} />\n",
      "<Panel size={2} />\n",
    ),
  ]);
  const result = highlightDiff(file, "tsx");
  assert.ok(
    result.right[1].some(
      (t) => t.text === "2" && t.className === "hljs-number",
    ),
  );
  assert.equal(
    result.right[1].map((t) => t.text).join(""),
    "<Panel size={2} />",
  );
});

test("explicit JSX and TSX snippets use the same JSX-aware highlighting", () => {
  for (const language of ["tsx", "jsx"]) {
    const tokens = highlightSnippet('<Button count={42} />', language).flat();
    assert.ok(tokens.some(t => t.text === "42" && t.className === "hljs-number"));
    assert.ok(tokens.some(t => t.text === "count" && t.className === "hljs-attr"));
  }
});
