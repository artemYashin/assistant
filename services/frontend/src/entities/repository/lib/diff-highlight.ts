import { common, createLowlight } from "lowlight";
import { refractor } from "refractor/core";
import tsx from "refractor/tsx";
import type { Root, RootContent } from "hast";
import type { splitDiff } from "./pr-diff.js";

const highlighter = createLowlight(common);
refractor.register(tsx); // Includes JSX and its TypeScript/JavaScript dependencies.
const jsxLanguages = new Set(["tsx", "jsx"]);
const supported = (language: string) =>
  jsxLanguages.has(language) || highlighter.registered(language);
const prismClasses: Record<string, string> = {
  keyword: "hljs-keyword",
  boolean: "hljs-literal",
  number: "hljs-number",
  string: "hljs-string",
  "attr-value": "hljs-string",
  regex: "hljs-regexp",
  comment: "hljs-comment",
  tag: "hljs-tag",
  "class-name": "hljs-type",
  "attr-name": "hljs-attr",
  function: "hljs-title",
  "function-variable": "hljs-title",
  "known-class-name": "hljs-type",
  builtin: "hljs-built_in",
  operator: "hljs-operator",
  punctuation: "hljs-punctuation",
  property: "hljs-property",
  constant: "hljs-variable",
  decorator: "hljs-meta",
};
export type CodeToken = { text: string; className: string };
export type HighlightedFile = {
  left: Record<number, CodeToken[]>;
  right: Record<number, CodeToken[]>;
};

export function highlightLines(code: string, language: string): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  const visit = (node: Root | RootContent, classes: string[]) => {
    if (node.type === "text") {
      node.value.split("\n").forEach((text, index) => {
        if (index) lines.push([]);
        if (text) lines[lines.length - 1].push({ text, className: classes.join(" ") });
      });
    } else if (node.type === "root" || node.type === "element") {
      const own = node.type === "element" ? node.properties.className : [];
      const names = Array.isArray(own) ? own.map(String) : [];
      // Flat rendered spans must use the innermost scope, not all ancestors:
      // otherwise CSS for a tag overrides the colours of its attrs/strings.
      const semantic = names.includes("token")
        ? names
            .map((name) => prismClasses[name])
            .filter(Boolean)
            .slice(-1)
        : names.filter((name) => name.startsWith("hljs-"));
      const next = names.includes("token") ? semantic : semantic.length ? semantic : classes;
      node.children.forEach((child) => visit(child, next));
    }
  };
  visit(
    jsxLanguages.has(language)
      ? refractor.highlight(code, language)
      : language === "auto"
        ? highlighter.highlightAuto(code)
        : highlighter.highlight(language, code),
    [],
  );
  return lines;
}

export function highlightSnippet(code: string, language: string): CodeToken[][] {
  const plain = () => code.split("\n").map((text) => [{ text, className: "" }]);
  const selected = language.trim().toLowerCase();
  if (code.length > 120_000 || (!selected && code.length > 12_000)) return plain();
  if (selected && !supported(selected)) return plain();
  try {
    return highlightLines(code, selected || "auto");
  } catch {
    return plain();
  }
}

export function highlightDiff(
  file: ReturnType<typeof splitDiff>[number],
  language: string,
): HighlightedFile {
  const result: HighlightedFile = { left: {}, right: {} };
  if (language === "plaintext" || !supported(language)) return result;
  // Only visible code is processed, never git markers or omitted gaps. Each
  // side/hunk is one block so multiline tokens retain their state within it.
  let budget = 120_000;
  for (const hunk of file.hunks) {
    for (const side of ["left", "right"] as const) {
      const lines = hunk.rows.flatMap((row) => (row[side] ? [row[side]!] : []));
      const code = lines.map((line) => line.text).join("\n");
      if (code.length > budget || lines.length > 5000) continue;
      budget -= code.length;
      try {
        const highlighted = highlightLines(code, language);
        lines.forEach((line, index) => {
          result[side][line.number] = highlighted[index] || [];
        });
      } catch {
        /* Unsupported fragments remain readable as plain code. */
      }
    }
  }
  return result;
}
