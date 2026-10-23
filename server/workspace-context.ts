import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { Store, AppError, type Context } from "./store.js";
import { LocalDevelopers } from "./local-developers.js";

export function workspaceContext(store: Store, context: Context, offset = 0) {
  const registry = store.contexts();
  const developers = new LocalDevelopers(store).list(context);
  const repositories = store.db
    .prepare(
      "SELECT id,client,project,azure_project,repository,mode,enabled FROM pr_projects WHERE client=? AND project=? ORDER BY enabled DESC,id",
    )
    .all(context.client, context.project);
  return {
    currentContext: context,
    azureProject: store.settings().azureProject,
    contexts: registry.slice(offset, offset + 10),
    contextTotal: registry.length,
    developers: developers.slice(offset, offset + 10),
    developerTotal: developers.length,
    repositories: repositories.slice(offset, offset + 10),
    repositoryTotal: repositories.length,
    nextOffset:
      Math.max(registry.length, developers.length, repositories.length) >
      offset + 10
        ? offset + 10
        : null,
    note: "Developers include global, customer and project scopes; client/project fields identify the owning scope. Developer assignments are local; repository mode required means required-reviewer-only, all means all PRs. No secrets included.",
  };
}
export function workspaceContextTool(
  store: Store,
  current: Context,
  assertActive: () => void,
) {
  return defineTool("get_workspace_context", {
    description:
      "Read Customers and Projects UI data: registered contexts, manually configured developers available from global/customer/project scopes, repository and PR synchronization mode. Defaults to current context; specify a known client/project to inspect another. Paginate with nextOffset until null for complete lists. Does not change selected context or settings.",
    parameters: z.object({
      client: z.string().max(200).optional(),
      project: z.string().max(200).optional(),
      offset: z.number().int().nonnegative().default(0),
    }),
    handler: async ({ client, project, offset = 0 }) => {
      assertActive();
      const selected =
        client === undefined && project === undefined
          ? current
          : { client: client ?? current.client, project: project ?? "" };
      if (
        (selected.client || selected.project) &&
        !store
          .contexts()
          .some(
            (c) =>
              c.client === selected.client &&
              (!selected.project || c.project === selected.project),
          )
      )
        throw new AppError(404, "Заказчик или проект не найден в справочнике");
      return workspaceContext(store, selected, offset);
    },
  });
}
