import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { Store, AppError, type Context } from "./store.js";
import type { Connectors } from "./connectors.js";
import type { PullRequests } from "./pull-requests.js";

export function synchronizationTools(store: Store, connectors: Connectors | undefined, prs: PullRequests | undefined, context: Context, assertActive: () => void, onSynced: (domain: "tickets" | "prs" | "teams") => void) {
  const source = store.source();
  const runs = new Map<string, Promise<unknown>>();
  const once = (name: string, action: () => Promise<unknown>) => {
    assertActive();
    if (source !== store.source()) throw new AppError(409, "Подключение изменилось. Повторите запрос синхронизации.");
    if (!runs.has(name)) runs.set(name, action().finally(() => onSynced(name as "tickets" | "prs" | "teams")));
    return runs.get(name)!;
  };
  return [
    ...(connectors ? [defineTool("sync_tickets", {
      description: "Refresh tracked tickets and import tickets assigned to the user from the current Azure connection, exactly like Synchronize tickets in UI. ONLY when the user explicitly asks to refresh/synchronize/import their tickets. No extra confirmation. Never call as a prerequisite for ordinary local search/list/count. Returns count only, not ticket bodies. Retained trash is skipped. At most once per request.",
      parameters: z.object({}).strict(),
      handler: async () => once("tickets", async () => ({ updated: true, ...await connectors.syncTickets(true) })),
    }), defineTool("sync_teams_chats", {
      description: "Refresh messages in watched Teams chats ONLY on an explicit user request to synchronize Teams chats/messages. Not Orbit assistant conversation history. No extra confirmation; never refresh before ordinary local reads. Returns counts only. At most once per request.",
      parameters: z.object({}).strict(),
      handler: async () => once("teams", async () => {
        if (!store.settings().teamsEnabled || !store.get("microsoft.connected", false)) throw new AppError(400, "Подключите и включите Teams в настройках.");
        return { updated: true, ...await connectors.syncTeams() };
      }),
    })] : []),
    ...(prs ? [defineTool("sync_pull_requests", {
      description: "Synchronize enabled PR repositories in the current customer/project from Azure ONLY when explicitly requested by the user. No extra confirmation. Never call for ordinary local PR search/list/count. Does not synchronize tickets or Teams. Returns repository counts/errors only, not descriptions. At most once per request.",
      parameters: z.object({}).strict(),
      handler: async () => once("prs", async () => {
        const monitors = prs.monitors().filter(m => m.enabled && (!context.client || m.client === context.client) && (!context.project || m.project === context.project));
        if (!monitors.length) throw new AppError(400, "В текущем контексте нет включённых репозиториев для синхронизации PR.");
        for (const monitor of monitors) { assertActive(); await prs.sync(monitor.id); }
        const ids = new Set(monitors.map(m => m.id));
        const errors = prs.monitors().filter(m => ids.has(m.id) && m.error).map(m => ({ repository: m.repository, error: m.error }));
        return { updated: errors.length === 0, repositories: monitors.length, errors };
      }),
    })] : []),
  ];
}
