export type TicketImageReason =
  | "empty_source"
  | "invalid_url"
  | "temporary_blob"
  | "unprocessed_inline"
  | "missing_inline_metadata"
  | "different_origin"
  | "different_collection"
  | "unsupported_path"
  | "missing_attachment"
  | "not_image"
  | "unmapped_source";

export type TicketImageDiagnostic = {
  format: 1;
  stage: "before_request";
  reason: TicketImageReason;
  sourceKind: "empty" | "inline" | "blob" | "http" | "other";
  sameOrigin?: boolean;
  sameCollection?: boolean;
  hasQuery?: boolean;
  attachmentFound?: boolean;
};

type ImageCard = {
  base: string;
  attachments?: { id: string; inline?: boolean; image?: boolean }[];
};

/** A diagnostic deliberately contains no source URL, ticket text or attachment IDs. */
export function ticketImagePreview(source: string, card: ImageCard, reference: string) {
  const diagnostic: TicketImageDiagnostic = {
    format: 1,
    stage: "before_request",
    reason: "invalid_url",
    sourceKind: !source.trim()
      ? "empty"
      : /^data:/i.test(source)
        ? "inline"
        : /^blob:/i.test(source)
          ? "blob"
          : /^https?:/i.test(source)
            ? "http"
            : "other",
  };
  const fail = (reason: TicketImageReason) => ({
    preview: null,
    diagnostic: { ...diagnostic, reason },
  });
  if (!source.trim()) return fail("empty_source");
  if (diagnostic.sourceKind === "blob") return fail("temporary_blob");
  if (diagnostic.sourceKind === "inline") return fail("unprocessed_inline");
  const attachments = card.attachments || [];
  const inlineId = /^https:\/\/orbit\.invalid\/ticket-inline-image\/(inline-[0-9a-f]{64})$/.exec(
    source,
  )?.[1];
  if (inlineId) {
    const attachment = attachments.find((a) => a.id === inlineId && a.inline);
    diagnostic.attachmentFound = !!attachment;
    if (!attachment) return fail("missing_inline_metadata");
    if (!attachment.image) return fail("not_image");
    return {
      preview: `/api/ticket-cards/${encodeURIComponent(reference)}/attachments/${inlineId}`,
      diagnostic: undefined,
    };
  }
  try {
    const base = new URL(card.base);
    const url = new URL(source, card.base + "/");
    diagnostic.sameOrigin = url.origin === base.origin;
    diagnostic.sameCollection = url.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/");
    diagnostic.hasQuery = !!url.search;
    if (!diagnostic.sameOrigin) return fail("different_origin");
    if (!diagnostic.sameCollection) return fail("different_collection");
    const id = /\/_apis\/wit\/attachments\/([0-9a-f-]{36})(?:$|\/)/i.exec(url.pathname)?.[1];
    if (!id) return fail("unsupported_path");
    const attachment = attachments.find((a) => a.id.toLowerCase() === id.toLowerCase());
    diagnostic.attachmentFound = !!attachment;
    if (!attachment) return fail("missing_attachment");
    if (!attachment.image) return fail("not_image");
    return {
      preview: `/api/ticket-cards/${encodeURIComponent(reference)}/attachments/${encodeURIComponent(attachment.id)}`,
      diagnostic: undefined,
    };
  } catch {
    return fail("invalid_url");
  }
}
