export type ChatProgress =
  | { stage: "preparing"; startedAt?: number }
  | { stage: "text"; messageId: string; text: string; replace?: boolean }
  | { stage: "tool"; toolId: string; name: string; startedAt?: number; durationMs?: number; status: "running" | "completed" | "error" };
