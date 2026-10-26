import { chatTicketPath, ticketPath } from "../../../shared/config/routes/index.js";

export function azureTicketPath(href: string, source?: string): string | null {
  if (!source) return null;
  try {
    const [base, project] = source.split("|");
    const root = new URL(base.replace(/\/$/, "") + "/" + encodeURIComponent(project));
    const url = new URL(href);
    if (url.origin !== root.origin) return null;
    const prefix = decodeURIComponent(root.pathname).replace(/\/$/, "").toLowerCase();
    const path = decodeURIComponent(url.pathname).toLowerCase();
    const tail = path.slice(prefix.length);
    if (!path.startsWith(prefix + "/")) return null;
    const id = /^\/_workitems\/edit\/([1-9]\d*)\/?$/.exec(tail)?.[1]
      ?? (tail === "/_workitems" ? url.searchParams.get("id") : null);
    return id && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? ticketPath(Number(id), source) : null;
  } catch { return null; }
}

export function shareTicketUrl(href: string): string {
  if (!chatTicketPath(href)) return href;
  const params = new URLSearchParams(href.split("?")[1]);
  const [base, project] = params.get("source")!.split("|");
  try {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || !project) return href;
    return base.replace(/\/$/, "") + "/" + encodeURIComponent(project) + "/_workitems/edit/" + params.get("id");
  } catch { return href; }
}
