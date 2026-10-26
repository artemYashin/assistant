/** Count referenced files, keeping removed drafts available for editor Undo. */
export function noteImageBudget(
  text: string,
  images: { id: string; file: { size: number } }[],
  kind: "free" | "ticket",
) {
  const prefix = kind === "free" ? "note-image" : "ticket-note-image";
  const active = images.filter((i) => text.includes(`https://orbit.invalid/${prefix}/${i.id}`));
  const pattern =
    kind === "free"
      ? /\/api\/notes\/[0-9a-f-]+\/images\/[0-9a-f-]+/g
      : /\/api\/ticket-note-images\/[0-9a-f-]+/g;
  return {
    count: active.length + new Set(text.match(pattern) || []).size,
    bytes: active.reduce((n, i) => n + i.file.size, 0),
  };
}
