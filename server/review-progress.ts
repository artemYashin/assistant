import type { ChatProgress } from "./chat-stream.js";

export const reviewBaseTools = ["ask_review_questions", "propose_memory", "read_memory"] as const;
export const reviewCodeTools = ["cite_code", "code_branches", "code_tree", "code_search", "code_read_file", "code_work_status"] as const;
export const reviewTicketTools = ["cite_ticket_content"] as const;
export const reviewToolLabels: Record<(typeof reviewBaseTools)[number] | (typeof reviewCodeTools)[number] | (typeof reviewTicketTools)[number], string> = {
  ask_review_questions: "Готовлю вопросы для уточнения",
  propose_memory: "Предлагаю сохранить знания в память",
  read_memory: "Читаю память",
  cite_ticket_content: "Цитирую требование тикета",
  cite_code: "Добавляю ссылку на код",
  code_branches: "Проверяю ветки репозитория",
  code_tree: "Изучаю структуру файлов",
  code_search: "Ищу связанный код",
  code_read_file: "Читаю код",
  code_work_status: "Проверяю готовность локального кода",
};

/** Ephemeral status, independent of retained debug logs and model context. */
export class ReviewProgress {
  private phases = new Map<string, string>();
  private tools = new Map<string, Map<string, string>>();
  prepare(id: string, text: string) { this.phases.set(id, text); }
  update(id: string, event: ChatProgress) {
    if (event.stage !== "tool") return;
    this.phases.set(id, "Анализирую изменения и готовлю ответ");
    const active = this.tools.get(id) || new Map<string, string>();
    if (event.status === "running") active.set(event.toolId, event.name);
    else active.delete(event.toolId);
    this.tools.set(id, active);
  }
  clear(id: string) { this.phases.delete(id); this.tools.delete(id); }
  text(id: string | undefined, status: string): string | null {
    if (status === "preparing_git") return "Подготавливаю локальную ветку Git";
    if (status === "queued") return "Ожидаю запуска ревью";
    if (status === "awaiting_answers") return "Ожидаю ваших ответов";
    if (status !== "running" || !id) return null;
    const name = [...(this.tools.get(id)?.values() || [])].at(-1);
    return name ? reviewToolLabels[name as keyof typeof reviewToolLabels] || "Выполняю инструмент ревью"
      : this.phases.get(id) || "Готовлю контекст ревью";
  }
}
