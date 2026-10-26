import type { ChatProgress } from "./chat-stream.js";

export const reviewBaseTools = ["ask_review_questions", "propose_memory", "read_memory"] as const;
export const reviewCodeTools = [
  "cite_code",
  "code_branches",
  "code_tree",
  "code_search",
  "code_read_file",
  "code_work_status",
] as const;
export const reviewTicketTools = ["cite_ticket_content"] as const;
/** Ephemeral status, independent of retained debug logs and model context. */
export class ReviewProgress {
  private phases = new Map<string, string>();
  private tools = new Map<string, Set<string>>();
  prepare(id: string, text: string) {
    this.phases.set(id, text);
  }
  update(id: string, event: ChatProgress) {
    if (event.stage === "text" && event.text.trim()) {
      if (!this.tools.get(id)?.size) this.phases.set(id, "Готовлю результат");
      return;
    }
    if (event.stage !== "tool") return;
    this.phases.set(id, "Анализирую изменения");
    const active = this.tools.get(id) || new Set<string>();
    if (event.status === "running") active.add(event.toolId);
    else active.delete(event.toolId);
    this.tools.set(id, active);
  }
  clear(id: string) {
    this.phases.delete(id);
    this.tools.delete(id);
  }
  text(id: string | undefined, status: string, activeReviewId?: string | null): string | null {
    if (["preparing_git", "queued"].includes(status) && id !== activeReviewId) {
      return activeReviewId ? "Ожидание завершения другого ревью" : "Ожидаю запуска ревью";
    }
    if (status === "preparing_git") return "Подготавливаю локальную ветку Git";
    if (status === "queued") return "Ожидаю запуска ревью";
    if (status === "awaiting_answers") return "Ожидаю ваших ответов";
    if (status !== "running" || !id) return null;
    return this.tools.get(id)?.size
      ? "Анализирую изменения"
      : this.phases.get(id) || "Анализирую изменения";
  }
}
