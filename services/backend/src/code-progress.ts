import { z } from "zod";
import { AppError } from "./store.js";

export const codeProgressSchema = z
  .object({
    stage: z.enum([
      "recovering",
      "connecting",
      "queued",
      "preparing",
      "fetching",
      "counting",
      "compressing",
      "receiving",
      "resolving",
      "unpacking",
      "finalizing",
      "tree",
      "file",
      "snapshot",
      "searching",
    ]),
    receivedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    bytesPerSecond: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    receivedObjects: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    totalObjects: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    updatedAt: z.number().int().positive().optional(),
    startedAt: z.number().int().positive().optional(),
    queuePosition: z.number().int().min(0).max(4).optional(),
    queueLength: z.number().int().min(1).max(5).optional(),
    percent: z.number().int().min(0).max(100).optional(),
  })
  .strict();
export type CodeProgress = z.infer<typeof codeProgressSchema>;

export async function readCodeStream(response: Response, report: (progress: CodeProgress) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError(502, "Пустой ответ сервиса кода");
  const decoder = new TextDecoder();
  let buffer = "",
    total = 0,
    finished = false,
    result: any;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 20 * 1024 * 1024) throw new AppError(502, "Ответ сервиса кода слишком большой");
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (finished) throw new AppError(502, "Некорректное завершение операции кода");
        if (event.type === "progress") {
          const parsed = codeProgressSchema.safeParse(event.progress);
          if (parsed.success) report(parsed.data);
        } else if (event.type === "error") {
          throw new AppError(
            502,
            typeof event.error === "string" ? event.error.slice(0, 3000) : "Ошибка сервиса кода",
          );
        } else if (event.type === "result") {
          result = event.data;
          finished = true;
        }
      }
    }
    if (!finished || buffer.trim())
      throw new AppError(502, "Соединение прервано до завершения операции кода");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
