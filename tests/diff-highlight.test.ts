import test from "node:test";
import assert from "node:assert/strict";
import { createTwoFilesPatch } from "diff";
import { splitDiff } from "../src/pr-diff.js";
import { diffLanguage, validDiffLanguage } from "../src/diff-languages.js";
import { highlightDiff, highlightLines } from "../src/diff-highlight.js";

test("diff language detects file extensions and safely restores stored choices", () => {
  assert.equal(diffLanguage("/src/Page.TSX"), "typescript");
  assert.equal(diffLanguage("/Program.cs"), "csharp");
  assert.equal(diffLanguage("/a.yaml"), "yaml");
  assert.equal(diffLanguage("/unknown.file"), "plaintext");
  assert.equal(validDiffLanguage("javascript"), "javascript");
  assert.equal(validDiffLanguage("plaintext"), "plaintext");
  assert.equal(validDiffLanguage("bogus"), "auto");
  assert.equal(validDiffLanguage(null), "auto");
});

test("highlight preserves exact code and multiline comment scopes without injecting HTML", () => {
  const code = '/* first\nsecond */\nconst text = "<img src=x onerror=alert(1)>";\n';
  const lines = highlightLines(code, "typescript");
  assert.equal(lines.map((line) => line.map((t) => t.text).join("")).join("\n"), code);
  assert.ok(lines[0].some((t) => t.className.includes("hljs-comment")));
  assert.ok(lines[1].some((t) => t.className.includes("hljs-comment")));
  assert.ok(lines[2].some((t) => t.className.includes("hljs-keyword")));
  assert.ok(lines[2].some((t) => t.text.includes("<img")));
});

test("diff highlights each side without changing original line numbers or text", () => {
  const [file] = splitDiff([createTwoFilesPatch("/a.ts", "/a.ts",
    "/* old\ncomment */\nconst x = 1;\n", "/* new\ncomment */\nconst x = 2;\nconst y = true;\n")]);
  const result = highlightDiff(file, "typescript");
  for (const side of ["left", "right"] as const) {
    for (const row of file.hunks.flatMap((h) => h.rows)) {
      const line = row[side];
      if (line) assert.equal(result[side][line.number].map((t) => t.text).join(""), line.text);
    }
  }
  assert.ok(result.right[2].some((t) => t.className.includes("hljs-comment")));
  assert.equal(result.left[4], undefined);
  assert.deepEqual(highlightDiff(file, "plaintext"), { left: {}, right: {} });
  assert.deepEqual(highlightDiff(file, "unknown"), { left: {}, right: {} });
});

test("oversized hunks fall back to plain code", () => {
  const [file] = splitDiff([createTwoFilesPatch("/a.ts", "/a.ts", "", "x".repeat(130000))]);
  assert.deepEqual(highlightDiff(file, "typescript"), { left: {}, right: {} });
});
