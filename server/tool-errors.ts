import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "./store.js";

export function toolFailure(tool: string, args: any, error: unknown) {
  const reference = randomUUID();
  const code =
    error instanceof AppError
      ? error.status
      : error instanceof z.ZodError
        ? "invalid_arguments"
        : "internal";
  const message =
    error instanceof AppError
      ? error.message
      : error instanceof z.ZodError
        ? "Некорректные параметры инструмента: " +
          error.issues
            .map(
              (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
            )
            .join("; ")
        : "Внутренняя ошибка инструмента. Проверьте текущее состояние перед повторной попыткой; подробности доступны в логах по коду ошибки.";
  console.error(
    "[agent-tool]",
    JSON.stringify({
      reference,
      tool,
      ticketId: Number.isSafeInteger(args?.id ?? args?.ticketId)
        ? (args.id ?? args.ticketId)
        : undefined,
      code,
      errorType: error instanceof Error ? error.name : "Unknown",
      frames:
        error instanceof Error
          ? error.stack
              ?.split("\n")
              .slice(1, 6)
              .map((line) => line.trim())
          : undefined,
      // Avoid logging arguments, ticket contents or upstream credentials.
      message: error instanceof AppError ? message : undefined,
    }),
  );
  return {
    success: false,
    error: message,
    code,
    reference,
    tool,
    retryable: false,
    ...(tool === "update_local_ticket_metadata" ||
    tool === "set_local_ticket_developers" ||
    tool === "set_developer_vacation" ||
    tool === "remove_local_ticket"
      ? { scope: "local", azureChanged: false }
      : {}),
  };
}
