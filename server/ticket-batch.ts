import { defineTool, type Tool } from "@github/copilot-sdk";
import { z } from "zod";
import { editMetadataSchema } from "./ticket-metadata-tools.js";
import { AppError } from "./store.js";
import { toolFailure } from "./tool-errors.js";

const id = z.number().int().positive();
export const ticketBatchSchema = z
  .object({
    operations: z
      .array(
        z.discriminatedUnion("action", [
          z
            .object({ action: z.literal("metadata"), data: editMetadataSchema })
            .strict(),
          z
            .object({
              action: z.literal("status"),
              id,
              state: z.string().trim().min(1).max(200),
            })
            .strict(),
          z
            .object({
              action: z.literal("developers"),
              id,
              developerIds: z.array(z.string()).max(50),
            })
            .strict(),
          z.object({ action: z.literal("add"), id }).strict(),
          z.object({ action: z.literal("remove"), id }).strict(),
        ]),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .refine(
    ({ operations }) =>
      operations.filter((op) => op.action === "status").length <= 25,
    "В одном пакете допускается не больше 25 изменений статуса в Azure",
  );

export function ticketBatchTool(
  tools: Tool<any>[],
  assertActive: () => void = () => {},
  changeStatuses?: (changes: { id: number; state: string }[]) => Promise<any[]>,
) {
  return defineTool("batch_update_tickets", {
    description:
      "Execute up to 50 explicitly requested ticket operations in order, grouping consecutive Azure status changes into one Azure batch request, with at most 25 Azure status changes per batch (also for mixed batches). Limits are validated before any operation starts. First resolve the exact IDs via list_tickets/get_ticket/get_local_ticket_metadata, including IDs from conversation history. Actions: metadata (data uses update_local_ticket_metadata schema), developers, add/remove LOCAL tracker, status in Azure. Add reads Azure but does not write it. Same authorization and verification as individual tools; no automatic retries or rollback. Returns success/error for EACH item; report partial success honestly. For larger sets send separate batches, never repeat completed or unconfirmed operations.",
    parameters: ticketBatchSchema,
    handler: async (input, invocation) => {
      const { operations } = ticketBatchSchema.parse(input);
      const results: any[] = [];
      let stopped = false;
      const statusResults = new Map<number, any>();
      for (const [index, op] of operations.entries()) {
        const ticketId = op.action === "metadata" ? op.data.id : op.id;
        if (stopped) {
          results.push({
            index,
            id: ticketId,
            action: op.action,
            success: false,
            skipped: true,
            error: "Пакет остановлен; операция не выполнялась",
          });
          continue;
        }
        try {
          if (!statusResults.has(index)) assertActive();
        } catch (error) {
          stopped = true;
          results.push({
            index,
            id: ticketId,
            action: op.action,
            ...toolFailure("batch_update_tickets", { id: ticketId }, error),
            skipped: true,
          });
          continue;
        }
        const name = {
          metadata: "update_local_ticket_metadata",
          status: "change_ticket_status",
          developers: "set_local_ticket_developers",
          add: "add_local_ticket",
          remove: "remove_local_ticket",
        }[op.action];
        const args =
          op.action === "metadata"
            ? op.data
            : op.action === "status"
              ? { id: op.id, state: op.state }
              : op.action === "developers"
                ? { ticketId: op.id, developerIds: op.developerIds }
                : { id: op.id };
        let value: any;
        try {
          if (op.action === "status" && changeStatuses) {
            if (!statusResults.has(index)) {
              const group: { id: number; state: string }[] = [];
              for (let j = index; j < operations.length; j++) {
                const next = operations[j];
                if (next.action !== "status") break;
                group.push({ id: next.id, state: next.state });
              }
              try {
                const values = await changeStatuses(group);
                group.forEach((_, offset) =>
                  statusResults.set(index + offset, values[offset]),
                );
              } catch (error) {
                group.forEach((item, offset) =>
                  statusResults.set(
                    index + offset,
                    toolFailure(name, item, error),
                  ),
                );
              }
            }
            value = statusResults.get(index);
          } else {
            const tool = tools.find((t) => t.name === name);
            if (!tool?.handler)
              throw new AppError(403, "Операция недоступна в текущем запросе");
            value = await tool.handler(args, invocation);
          }
        } catch (error) {
          value = toolFailure(name, args, error);
        }
        results.push({
          index,
          id: ticketId,
          action: op.action,
          success: value?.success === true,
          ...(value?.success === true
            ? {
                state: value.state,
                changedFields: value.changedFields,
                azureChanged: value.azureChanged,
              }
            : {
                error: String(
                  value?.error || value?.reason || "Изменение не подтверждено",
                ).slice(0, 1000),
                reference: value?.reference,
                code: value?.code,
              }),
        });
      }
      const succeeded = results.filter((r) => r.success).length;
      return {
        success: succeeded === results.length,
        total: results.length,
        succeeded,
        failed: results.length - succeeded,
        stopped,
        results,
      };
    },
  });
}
