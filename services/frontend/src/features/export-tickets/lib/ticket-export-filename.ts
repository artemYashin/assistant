/** A portable download name; the selected export format always owns the extension. */
export function ticketExportFilename(
  name: string,
  format: "csv" | "xlsx",
  trash = false,
  date = new Date(),
): string {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  const fallback = `orbit-tickets${trash ? "-trash" : ""}-${stamp}`;
  let base = name
    .trim()
    .replace(/(?:\.(?:xlsx|csv))+$/i, "")
    // eslint-disable-next-line no-control-regex -- Remove control bytes from untrusted input/output.
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
    .replace(/^[. ]+|[. ]+$/g, "");
  base =
    Array.from(base)
      .slice(0, 100)
      .join("")
      .replace(/[. ]+$/g, "") || fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `_${base}`;
  return `${base}.${format}`;
}
