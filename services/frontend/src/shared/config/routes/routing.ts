export const pagePaths = {
  overview: "/",
  calendar: "/calendar",
  code: "/code",
  inbox: "/inbox",
  tickets: "/tickets",
  developers: "/developers",
  approvals: "/approvals",
  memory: "/memory",
  settings: "/settings",
  updates: "/updates",
  notes: "/notes",
  usage: "/usage",
  pullrequests: "/pull-requests",
} as const;
export type Page = keyof typeof pagePaths;
export function pageForPath(pathname: string): Page | undefined {
  const path = pathname.replace(/\/+$/, "") || "/";
  return (Object.keys(pagePaths) as Page[]).find((page) => pagePaths[page] === path);
}
export function ticketPath(id: number, source?: string) {
  return `/tickets?${new URLSearchParams({ id: String(id), ...(source ? { source } : {}) })}`;
}

export function pullRequestPath(pr: { monitor: string; repo: string; number: number }) {
  return `/pull-requests?${new URLSearchParams({ monitor: pr.monitor, repo: pr.repo, number: String(pr.number) })}`;
}

// Only accept the internal ticket route; never treat arbitrary Markdown URLs as app navigation.
export function chatTicketPath(value: string): string | null {
  if (!value.startsWith("/tickets?")) return null;
  const params = new URLSearchParams(value.slice("/tickets?".length));
  const id = params.get("id");
  const source = params.get("source");
  if (!id || !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)) || !source) return null;
  return ticketPath(Number(id), source);
}

export function chatTicketCitation(value: string) {
  if (!chatTicketPath(value)) return null;
  const params = new URLSearchParams(value.slice("/tickets?".length));
  const section = params.get("section"),
    quote = params.get("quote");
  if (
    !section ||
    !["description", "criteria", "repro"].includes(section) ||
    !quote ||
    quote.length > 600
  )
    return null;
  return { id: Number(params.get("id")), source: params.get("source")!, section, quote };
}
