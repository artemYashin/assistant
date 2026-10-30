import { azureImageOriginAllowed } from "./azure-image-origin.js";

/** Match URL parsing of boundary C0 controls and spaces without changing the path. */
export function trimImageUrlPadding(source: string): string {
  let start = 0;
  let end = source.length;
  while (start < end && source.charCodeAt(start) <= 32) start++;
  while (end > start && source.charCodeAt(end - 1) <= 32) end--;
  return source.slice(start, end);
}

/** Azure sometimes emits a bare root-relative attachment ID in rich text. */
export function shortTicketAttachmentId(source: string): string | undefined {
  return /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#][^\\\s]*)?$/i
    .exec(trimImageUrlPadding(source))?.[1]
    .toLowerCase();
}

/** Resolve attachment identity only. Downloads always use the configured Azure API. */
export function ticketAttachmentId(source: string, baseUrl: string): string | undefined {
  try {
    const base = new URL(baseUrl);
    const shortId = shortTicketAttachmentId(source);
    if (shortId)
      return base.protocol === "https:" && !base.username && !base.password ? shortId : undefined;
    const url = new URL(source, baseUrl.replace(/\/$/, "") + "/");
    if (
      !azureImageOriginAllowed(url, base) ||
      !url.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/")
    )
      return undefined;
    return /\/_apis\/wit\/attachments\/([0-9a-f-]{36})(?:$|\/)/i
      .exec(url.pathname)?.[1]
      .toLowerCase();
  } catch {
    return undefined;
  }
}
