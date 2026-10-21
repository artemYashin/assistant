export type ChatProgress =
  | { stage: "data_synced"; domain: "tickets" | "prs" | "teams" }
  | { stage: "close_ticket_details" }
  | { stage: "show_tickets"; tickets: { id: number; title: string }[]; source: string }
  | { stage: "preparing"; startedAt?: number }
  | { stage: "usage"; inputTokens: number; outputTokens: number; reports: number; partial: boolean; contextUsage?: { currentTokens: number; tokenLimit: number; model: string; updatedAt: string } | null }
  | { stage: "text"; messageId: string; text: string; replace?: boolean }
  | { stage: "tool"; toolId: string; name: string; names?: string[]; offsetMs?: number; startedAt?: number; durationMs?: number; status: "running" | "completed" | "error" };
