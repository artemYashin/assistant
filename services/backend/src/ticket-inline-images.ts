import { createHash } from "node:crypto";
import { commentImageType } from "./comment-markdown.js";

const limit = 10 * 1024 * 1024;
const pattern = /data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\r\n]+/gi;
export function ticketInlineImages(card: any) {
  const images = new Map<string, { id: string; body: Buffer; type: string }>();
  let total = 0;
  const scan = (text: unknown) => {
    if (typeof text !== "string") return;
    for (const [source] of text.matchAll(pattern)) {
      if (images.has(source) || source.length > Math.ceil(limit / 3) * 4 + 128) continue;
      const [header, encoded] = source.split(",");
      const payload = encoded.replace(/[\r\n]/g, "");
      if (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) continue;
      const body = Buffer.from(payload, "base64");
      if (body.toString("base64") !== payload) continue;
      try {
        const type = commentImageType(body);
        const declared = header
          .slice(5, header.indexOf(";"))
          .toLowerCase()
          .replace("image/jpg", "image/jpeg");
        if (type !== declared || total + body.length > 20 * 1024 * 1024) continue;
        const id = "inline-" + createHash("sha256").update(body).digest("hex");
        images.set(source, { id, body, type });
        total += body.length;
      } catch {
        /* Unsupported or oversized embedded data stays unavailable. */
      }
    }
  };
  Object.values(card.fields || {}).forEach(scan);
  for (const comment of card.comments || []) {
    scan(comment.richText);
    scan(comment.text);
  }
  return images;
}

// Adapt old and new snapshots in memory; keep original HTML/data intact in SQLite.
export function withTicketInlineImages<
  T extends { fields?: any; comments?: any; attachments?: any },
>(card: T): T {
  const images = ticketInlineImages(card);
  if (!images.size) return card;
  const replace = (value: unknown) =>
    typeof value === "string"
      ? value.replace(pattern, (source) => {
          const image = images.get(source);
          return image ? `https://orbit.invalid/ticket-inline-image/${image.id}` : source;
        })
      : value;
  const attachments = new Map((card.attachments || []).map((a: any) => [a.id, a]));
  for (const image of images.values())
    attachments.set(image.id, {
      id: image.id,
      name: "Изображение в тексте",
      image: true,
      inline: true,
    });
  return {
    ...card,
    fields: Object.fromEntries(
      Object.entries(card.fields || {}).map(([key, value]) => [key, replace(value)]),
    ),
    comments: (card.comments || []).map((comment: any) => ({
      ...comment,
      richText: replace(comment.richText),
      text: replace(comment.text),
    })),
    attachments: [...attachments.values()],
  } as T;
}
