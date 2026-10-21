import { common, createLowlight } from "lowlight";
import type { Root, RootContent } from "hast";
import type { splitDiff } from "./pr-diff.js";

const highlighter = createLowlight(common);
export type CodeToken = { text: string; className: string };
export type HighlightedFile = { left: Record<number, CodeToken[]>; right: Record<number, CodeToken[]> };

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
      const next = [...classes, ...(Array.isArray(own) ? own.map(String) : [])];
      node.children.forEach((child) => visit(child, next));
    }
  };
  visit(language === "auto" ? highlighter.highlightAuto(code) : highlighter.highlight(language, code), []);
  return lines;
}

export function highlightSnippet(code: string, language: string): CodeToken[][] {
  const plain = () => code.split("\n").map(text => [{ text, className: "" }]);
  const selected = language.trim().toLowerCase();
  if (code.length > 120_000 || (!selected && code.length > 12_000)) return plain();
  if (selected && !highlighter.registered(selected)) return plain();
  try {
    return highlightLines(code, selected || "auto");
  } catch {
    return plain();
  }
}

export function highlightDiff(file: ReturnType<typeof splitDiff>[number], language: string): HighlightedFile {
  const result: HighlightedFile = { left: {}, right: {} };
  if (language === "plaintext" || !highlighter.registered(language)) return result;
  // Only visible code is processed, never git markers or omitted gaps. Each
  // side/hunk is one block so multiline tokens retain their state within it.
  let budget = 120_000;
  for (const hunk of file.hunks) {
    for (const side of ["left", "right"] as const) {
      const lines = hunk.rows.flatMap((row) => row[side] ? [row[side]!] : []);
      const code = lines.map((line) => line.text).join("\n");
      if (code.length > budget || lines.length > 5000) continue;
      budget -= code.length;
      try {
        const highlighted = highlightLines(code, language);
        lines.forEach((line, index) => { result[side][line.number] = highlighted[index] || []; });
      } catch { /* Unsupported fragments remain readable as plain code. */ }
    }
  }
  return result;
}
