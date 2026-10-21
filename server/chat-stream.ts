export type ChatProgress =
  | { stage: "data_synced"; domain: "tickets" | "prs" | "teams" | "memory" }
  | { stage: "close_ticket_details" }
  | { stage: "show_tickets"; tickets: { id: number; title: string }[]; source: string }
  | { stage: "preparing"; startedAt?: number }
  | { stage: "usage"; inputTokens: number; outputTokens: number; reports: number; partial: boolean; contextUsage?: { currentTokens: number; tokenLimit: number; model: string; updatedAt: string } | null }
  | { stage: "text"; messageId: string; text: string; replace?: boolean }
  | { stage: "tool"; toolId: string; name: string; names?: string[]; offsetMs?: number; startedAt?: number; durationMs?: number; status: "running" | "completed" | "error" };

export type ChatTimelineItem =
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; tool: Extract<ChatProgress, { stage: "tool" }> };
export function updateChatTimeline(items: ChatTimelineItem[], event: ChatProgress): ChatTimelineItem[] {
  if (event.stage !== "text" && event.stage !== "tool") return items;
  const id = event.stage === "text" ? event.messageId : event.toolId;
  const kind = event.stage === "text" ? "text" : "tool";
  const index = items.findIndex(item => item.kind === kind && item.id === id);
  const previous = items[index];
  const item: ChatTimelineItem = event.stage === "text"
    ? { kind: "text", id, text: event.replace || previous?.kind !== "text" ? event.text : previous.text + event.text }
    : { kind: "tool", id, tool: event };
  if (index < 0) return [...items, item];
  return items.map((old, i) => i === index ? item : old);
}
