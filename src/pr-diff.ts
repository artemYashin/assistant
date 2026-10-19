import { parsePatch } from "diff";

export type DiffLine = { number: number; text: string };
export type DiffRow = {
  kind: "context" | "change" | "notice";
  left?: DiffLine;
  right?: DiffLine;
  notice?: string;
};
export function splitDiff(patches: string[]) {
  return patches
    .flatMap((patch) => parsePatch(patch))
    .map((file) => ({
      before: file.oldFileName || "",
      after: file.newFileName || "",
      added: file.hunks.reduce(
        (n, h) => n + h.lines.filter((l) => l.startsWith("+")).length,
        0,
      ),
      removed: file.hunks.reduce(
        (n, h) => n + h.lines.filter((l) => l.startsWith("-")).length,
        0,
      ),
      hunks: file.hunks.map((hunk) => {
        let oldLine = hunk.oldStart,
          newLine = hunk.newStart;
        const rows: DiffRow[] = [];
        let removed: DiffLine[] = [],
          added: DiffLine[] = [];
        const flush = () => {
          for (let i = 0; i < Math.max(removed.length, added.length); i++)
            rows.push({ kind: "change", left: removed[i], right: added[i] });
          removed = [];
          added = [];
        };
        for (const line of hunk.lines) {
          if (line.startsWith("-"))
            removed.push({ number: oldLine++, text: line.slice(1) });
          else if (line.startsWith("+"))
            added.push({ number: newLine++, text: line.slice(1) });
          else if (line.startsWith("\\")) {
            flush();
            rows.push({
              kind: "notice",
              notice: "Нет перевода строки в конце файла",
            });
          } else {
            flush();
            rows.push({
              kind: "context",
              left: { number: oldLine++, text: line.slice(1) },
              right: { number: newLine++, text: line.slice(1) },
            });
          }
        }
        flush();
        return {
          label: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
          rows,
        };
      }),
    }));
}

export function diffFileLabel(path: string) {
  const parts = path.split("/");
  const name = parts.pop() || path;
  const directory = parts
    .map((part) => {
      const chars = Array.from(part);
      return chars.length > 7
        ? chars.slice(0, 3).join("") + "…" + chars.slice(-3).join("")
        : part;
    })
    .join("/");
  return { name, directory: directory ? directory + "/" : "" };
}
