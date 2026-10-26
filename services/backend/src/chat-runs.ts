import { randomUUID } from "node:crypto";
import { AppError } from "./store.js";
import type { ChatProgress } from "./chat-stream.js";

type Context = { client: string; project: string };
type Run = {
  id: string;
  context: Context;
  sessionId: string;
  events: ChatProgress[];
  done: boolean;
  data?: unknown;
  error?: string;
  finishedAt?: number;
};

// Browser connections only observe runs: disconnecting never cancels model work.
export class ChatRuns {
  private runs = new Map<string, Run>();
  active(context?: Context, sessionId?: string) {
    return [...this.runs.values()].find(
      (run) =>
        !run.done &&
        (!context ||
          (run.context.client === context.client && run.context.project === context.project)) &&
        (!sessionId || run.sessionId === sessionId),
    );
  }
  start(
    context: Context,
    sessionId: string,
    execute: (emit: (event: ChatProgress) => void) => Promise<unknown>,
  ) {
    if (this.active()) throw new AppError(409, "Ассистент ещё отвечает на предыдущий запрос");
    for (const [id, run] of this.runs)
      if (run.finishedAt && Date.now() - run.finishedAt > 600_000) this.runs.delete(id);
    const run: Run = {
      id: randomUUID(),
      context: { ...context },
      sessionId,
      events: [{ stage: "preparing", startedAt: Date.now() }],
      done: false,
    };
    this.runs.set(run.id, run);
    void (async () => {
      try {
        run.data = await execute((event) => run.events.push(event));
      } catch (error) {
        run.error =
          error instanceof AppError ? error.message : "Не удалось завершить ответ ассистента";
      } finally {
        run.done = true;
        run.finishedAt = Date.now();
        setTimeout(() => this.runs.delete(run.id), 600_000).unref();
      }
    })();
    return run.id;
  }
  page(id: string, after: number) {
    const run = this.runs.get(id);
    if (!run)
      throw new AppError(404, "Запрос больше не выполняется на сервере. Обновите историю чата.");
    const events = run.events.slice(after, after + 250);
    const cursor = after + events.length;
    const done = run.done && cursor >= run.events.length;
    return { events, cursor, done, ...(done ? { data: run.data, error: run.error } : {}) };
  }
}
