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
      added: file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.startsWith("+")).length, 0),
      removed: file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.startsWith("-")).length, 0),
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
          if (line.startsWith("-")) removed.push({ number: oldLine++, text: line.slice(1) });
          else if (line.startsWith("+")) added.push({ number: newLine++, text: line.slice(1) });
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
      return chars.length > 7 ? chars.slice(0, 3).join("") + "…" + chars.slice(-3).join("") : part;
    })
    .join("/");
  return { name, directory: directory ? directory + "/" : "" };
}

/** Human-readable file size; never confuse missing metadata with an empty file. */
export function diffFileSize(bytes?: number) {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const unit =
    bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
}

export type SkippedDiffFile = { before: string; after: string; reason: string };
export type DisplayDiffFile = ReturnType<typeof splitDiff>[number] & { skipReason?: string };
export function displayDiffFiles(
  patches: string[],
  skipped: SkippedDiffFile[] = [],
): DisplayDiffFile[] {
  const files: DisplayDiffFile[] = splitDiff(patches);
  for (const file of skipped) {
    if (!files.some((existing) => existing.before === file.before && existing.after === file.after))
      files.push({
        before: file.before,
        after: file.after,
        skipReason: file.reason,
        added: 0,
        removed: 0,
        hunks: [],
      });
  }
  return files;
}
