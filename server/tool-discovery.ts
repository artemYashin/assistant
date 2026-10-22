import { defineTool, type Tool } from "@github/copilot-sdk";
import { z } from "zod";
import { AppError } from "./store.js";

const catalog: Record<string, string> = {
  read_memory: "Read full details of one relevant memory by its catalog ID.",
  read_memory_proposal: "Read a pending memory proposal for refinement in the current scope.",
  edit_memory_proposal: "Edit an existing pending memory proposal at user request, without approving it or creating a duplicate.",
  cite_code: "Create clickable file/line-range references opening highlighted code in the repository viewer.",
  show_code_branches: "Display branch buttons with copy and navigation to code page; cached names only.",
  code_work_status: "Read current Git jobs, download progress and queue without starting work.",
  code_branches: "Search cached branch names by substring, or list with pagination; no network.",
  code_tree: "Browse a local directory's file names/types/sizes without bodies.",
  code_search: "Find files by name/path or grep code with short numbered snippets; local only.",
  code_read_file: "Read focused code ranges around search hits; returns totalLines. Full-file reads opt-in when needed; no edits.",
  get_ticket_links_batch: "Read links/images of multiple cached tickets in one call; per-ticket pagination, no Azure.",
  get_cached_ticket_content_batch: "Read multiple cached ticket bodies in one call; per-ticket pagination, no Azure.",
  get_ticket_links: "Get only cached links/images for one ticket; filter labels/URLs, no full bodies or Azure.",
  cite_ticket_content: "Verify an exact cached quote and get a link to its highlighted original section.",
  sync_tickets: "Explicit user request only: refresh/import user's Azure tickets. No extra confirmation.",
  sync_pull_requests: "Explicit user request only: refresh PRs in current context. No extra confirmation.",
  sync_teams_chats: "Explicit user request only: refresh watched Teams messages, not assistant history.",
  close_ticket_details: "Close ticket detail viewer and expand chat automatically; no data changes.",
  show_ticket_details: "Open UI ticket details, with a sidebar for multiple IDs; no bodies in model context.",
  get_cached_ticket_content: "Read full cached description/criteria/repro of a candidate, paged; no Azure calls.",
  search_ticket_content: "Search local notes and cached ticket descriptions/criteria/repro, optionally by ticket id; short excerpts, no Azure.",
  list_local_tags: "List/search existing local tag names, paginated; no Azure calls.",
  list_tickets:
    "Search/page local summaries; filters or exact IDs; full detail requires consent.",
  get_ticket: "Read one ticket by ID; local summary by default.",
  get_local_ticket_metadata:
    "Read local notes, tags and priority by ticket ID.",
  get_ticket_states:
    "Resolve valid Azure status names for ticket IDs and a requested status.",
  request_azure_ticket_lookup:
    "Offer an Azure lookup plan: IDs/filters; user chooses read or import.",
  lookup_azure_tickets: "Execute the user's approved Azure lookup plan.",
  add_local_ticket: "Import/restore a ticket ID in the local tracker.",
  remove_local_ticket:
    "Move a ticket ID to local trash, never delete in Azure.",
  change_ticket_status: "Change one ticket's Azure status and verify it.",
  update_local_ticket_metadata:
    "Edit local notes, priority or tags for one ticket ID.",
  batch_update_tickets:
    "Batch local edits/import/removal/assignments or Azure status changes: IDs and desired values.",
  list_local_developers:
    "List manually configured developers in the current project.",
  set_local_ticket_developers:
    "Set local assignees: ticket ID and developer IDs.",
  get_workspace_context:
    "Read customer/project/repository/developer settings; paginated.",
  list_pull_requests: "Count/filter local PRs; select summary fields, conflicts and review status. No Azure calls.",
  get_pull_request:
    "Read PR details/saved review: monitor, repository, PR number and section.",
  request_pull_request_review:
    "Queue PR review: monitor, repository and PR number.",
  list_memories: "List memory IDs and short summaries in current scope; read_memory loads selected details.",
  save_memory: "Submit a requested fact for UI approval in general/client/project/project_review memory; never saves directly.",
  propose_memory: "Propose a useful fact for approval, including project_review guidance: scope, text and reason.",
  list_chats: "List locally synchronized Teams chats.",
  read_teams_messages: "Read locally stored messages by chat ID.",
  list_inbox: "Read locally detected ticket mentions.",
  propose_teams_message:
    "Draft a Teams message for separate UI approval: chat ID and text.",
};

const schema = z.object({ names: z.array(z.string()).min(1).max(8) }).strict();

export function createToolDiscovery(
  tools: Tool<any>[],
  publish: (tools: Tool<any>[]) => Promise<void>,
  assertActive: () => void,
) {
  const known = new Map(tools.map((tool) => [tool.name, tool]));
  const loaded = new Set<string>();
  let queue = Promise.resolve();
  const discovery = defineTool("load_tools", {
    description:
      "Load full schemas before using a capability. Request only tools needed now; combine related names in one call. Loaded tools remain available for this request. Catalog:\n" +
      tools
        .map(
          (tool) => tool.name + ": " + (catalog[tool.name] || tool.description),
        )
        .join("\n"),
    parameters: schema,
    handler: async (args) => {
      const { names } = schema.parse(args);
      const work = queue.then(async () => {
        assertActive();
        for (const name of names)
          if (!known.has(name))
            throw new AppError(400, "Unknown tool: " + name);
        const next = new Set([...loaded, ...names]);
        if (next.size !== loaded.size) {
          await publish([
            discovery,
            ...[...next].map((name) => known.get(name)!),
          ]);
          assertActive();
          for (const name of next) loaded.add(name);
        }
        return {
          loaded: names,
          note: "Schemas are now available. Call the loaded tools with their declared parameters.",
        };
      });
      queue = work.then(
        () => {},
        () => {},
      );
      return work;
    },
  });
  return discovery;
}
