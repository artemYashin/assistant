import { azureImageOriginAllowed } from "./azure-image-origin.js";

/** Resolve attachment identity only. Downloads always use the configured Azure API. */
export function ticketAttachmentId(source: string, baseUrl: string): string | undefined {
  try {
    const base = new URL(baseUrl);
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
