import { z } from "zod";
import type { Tool } from "@github/copilot-sdk";
import { AppError, type Store } from "./store.js";
import {
  hasLocalManagement,
  managementFields,
  withoutManagement,
  workMode,
} from "./work-mode.js";
export const managementTools = new Set([
  "list_local_developers",
  "set_local_ticket_developers",
  "set_developer_vacation",
]);
const values = new Set([...managementFields, "vacation"]);
export function developerToolSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(developerToolSchema);
  if (!schema || typeof schema !== "object") return schema;
  const result: any = { ...schema };
  if (result.properties) {
    result.properties = Object.fromEntries(
      Object.entries(result.properties)
        .filter(([key]) => !managementFields.has(key))
        .map(([key, v]) => [key, developerToolSchema(v)]),
    );
    if (result.required)
      result.required = result.required.filter(
        (k: string) => !managementFields.has(k),
      );
  }
  for (const key of ["items", "additionalProperties"])
    if (result[key] && typeof result[key] === "object")
      result[key] = developerToolSchema(result[key]);
  for (const key of ["anyOf", "oneOf", "allOf"])
    if (result[key])
      result[key] = result[key]
        .filter(
          (v: any) =>
            !values.has(v.const) && !values.has(v.properties?.action?.const),
        )
        .map(developerToolSchema);
  if (result.enum) result.enum = result.enum.filter((v: any) => !values.has(v));
  if (Array.isArray(result.default))
    result.default = result.default.filter((v: any) => !values.has(v));
  return result;
}
export function assertDeveloperArguments(input: any) {
  if (Array.isArray(input)) {
    input.forEach(assertDeveloperArguments);
    return;
  }
  if (!input || typeof input !== "object") return;
  for (const [key, value] of Object.entries(input)) {
    if (managementFields.has(key))
      throw new AppError(
        403,
        "Локальные разработчики, поручения и отпуска недоступны в режиме разработчика.",
      );
    if (
      [
        "fields",
        "columns",
        "sortBy",
        "types",
        "kind",
        "kinds",
        "action",
        "type",
      ].includes(key) &&
      [value].flat().some((v) => values.has(v as string))
    )
      throw new AppError(403, "Это поле недоступно в режиме разработчика.");
    assertDeveloperArguments(value);
  }
}
export function modeTools(store: Store, tools: Tool<any>[]): Tool<any>[] {
  const mode = workMode(store.settings()),
    management = mode === "lead";
  return tools
    .filter((t) => management || !managementTools.has(t.name))
    .map((tool) => {
      const original: any = tool.parameters;
      const schema =
        !management && original?.safeParse
          ? z.toJSONSchema(original, { unrepresentable: "any" })
          : original;
      return {
        ...tool,
        ...(!management
          ? {
              parameters: developerToolSchema(schema),
              description: tool.description?.includes("In Developer mode")
                ? tool.description
                : tool.description +
                  " In Developer mode local developers, local assignments and vacations are unavailable. Never request those fields, filters or operations; Azure assignees remain available.",
            }
          : {}),
        handler: async (args: any, invocation: any) => {
          if (workMode(store.settings()) !== mode)
            throw new AppError(
              409,
              "Режим работы изменился. Повторите запрос в новой конфигурации.",
            );
          if (!management) {
            assertDeveloperArguments(args);
            if (tool.name.includes("calendar")) {
              const ids = [
                args.id,
                ...(args.items || []).map((i: any) => i.id),
              ].filter(Boolean);
              if (
                ids.some((id) =>
                  store.db
                    .prepare(
                      "SELECT 1 FROM developer_vacations WHERE event_id=?",
                    )
                    .get(id),
                )
              )
                throw new AppError(
                  403,
                  "Отпуска недоступны в режиме разработчика.",
                );
            }
          }
          const result = await tool.handler!(
            original?.parse ? original.parse(args) : args,
            invocation,
          );
          return management ? result : withoutManagement(result);
        },
      };
    });
}
