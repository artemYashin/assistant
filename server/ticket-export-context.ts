import { z } from "zod";
import { exportColumns } from "./ticket-export-columns.js";
export const exportColumnSchema = z.enum(
  exportColumns.map((column) => column.key) as [
    (typeof exportColumns)[number]["key"],
    ...(typeof exportColumns)[number]["key"][],
  ],
);
export const ticketExportContextSchema = z
  .object({
    state: z.enum(["closed", "open", "minimized"]),
    ids: z.array(z.number().int().positive().safe()).max(20000),
    total: z.number().int().nonnegative(),
    columns: z.array(exportColumnSchema).max(exportColumns.length),
    format: z.enum(["xlsx", "csv"]),
  })
  .strict();
export type TicketExportContext = z.infer<typeof ticketExportContextSchema>;
