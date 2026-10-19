import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { Store, AppError, type Context } from "./store.js";
import type { PullRequests } from "./pull-requests.js";

export function prTools(
  store: Store,
  service: PullRequests,
  context: Context,
  prompt: string,
  assertActive: () => void,
) {
  const scope = "(?='' OR m.client=?) AND (?='' OR m.project=?)";
  const scopeArgs = [
    context.client,
    context.client,
    context.project,
    context.project,
  ];
  const identity = z.object({
    monitor: z.string().min(1),
    repo: z.string().min(1),
    number: z.number().int().positive(),
  });
  const find = (key: z.infer<typeof identity>) => {
    assertActive();
    const row = store.db
      .prepare(
        `SELECT p.*,m.client,m.project,m.azure_project FROM pull_requests p JOIN pr_projects m ON m.id=p.monitor WHERE p.monitor=? AND p.repo=? AND p.number=? AND ${scope}`,
      )
      .get(key.monitor, key.repo, key.number, ...scopeArgs) as any;
    if (!row)
      throw new AppError(
        404,
        "PR не найден в текущем контексте. Сначала получите список PR; номер может повторяться в разных репозиториях.",
      );
    return row;
  };
  return [
    defineTool("list_pull_requests", {
      description:
        "List locally synchronized PRs in the current client/project. Returns exact monitor/repo identities required by other PR tools. No Azure mutation. Paginate until hasMore=false; data may lag sync.",
      parameters: z.object({
        offset: z.number().int().nonnegative().default(0),
      }),
      handler: async ({ offset = 0 }) => {
        assertActive();
        const rows = store.db
          .prepare(
            `SELECT p.monitor,p.repo,p.number,substr(p.title,1,200) title,p.draft,p.in_scope,p.created_at,p.synced_at FROM pull_requests p JOIN pr_projects m ON m.id=p.monitor WHERE ${scope} ORDER BY p.created_at DESC,p.monitor,p.repo,p.number LIMIT 21 OFFSET ?`,
          )
          .all(...scopeArgs, offset);
        const total = store.db
          .prepare(
            `SELECT COUNT(*) total FROM pull_requests p JOIN pr_projects m ON m.id=p.monitor WHERE ${scope}`,
          )
          .get(...scopeArgs) as any;
        return {
          scope: "local",
          total: total.total,
          items: rows.slice(0, 20),
          hasMore: rows.length > 20,
          nextOffset: rows.length > 20 ? offset + 20 : null,
        };
      },
    }),
    defineTool("get_pull_request", {
      description:
        "Read synchronized PR metadata, description or saved review of its current commit version. Long text is paginated. Does not fetch changes or start review. Never claim a PR reviewed based only on its description.",
      parameters: identity.extend({
        section: z.enum(["description", "review"]).default("description"),
        offset: z.number().int().nonnegative().default(0),
      }),
      handler: async (input) => {
        const args = {
          ...input,
          offset: input.offset ?? 0,
          section: input.section ?? "description",
        };
        const p = find(args);
        const review = store.db
          .prepare(
            "SELECT id,status,summary,error FROM pr_reviews WHERE monitor=? AND repo=? AND number=? AND head=? AND target=? ORDER BY rowid DESC LIMIT 1",
          )
          .get(p.monitor, p.repo, p.number, p.head, p.target) as any;
        const content = String(
          args.section === "review"
            ? review?.summary || ""
            : p.description || "",
        );
        // Escape-heavy source text still fits below the generic tool response guard.
        const text = content.slice(args.offset, args.offset + 2000);
        return {
          monitor: p.monitor,
          repo: p.repo,
          number: p.number,
          title: String(p.title).slice(0, 300),
          author: String(p.author || "").slice(0, 200),
          sourceBranch: p.source_branch,
          targetBranch: p.target_branch,
          draft: !!p.draft,
          inScope: !!p.in_scope,
          syncedAt: p.synced_at,
          reviewId: review?.id,
          reviewStatus: review?.status || "not_started",
          reviewError: review?.error,
          section: args.section,
          text,
          totalCharacters: content.length,
          nextOffset:
            args.offset + text.length < content.length
              ? args.offset + text.length
              : null,
        };
      },
    }),
    defineTool("request_pull_request_review", {
      description:
        "Queue automatic LLM code review only when the current user message explicitly requests review. Returns actual job status; queued is not completed. Work starts after chat releases the model, subject to daily limits. No Azure comments, votes or changes.",
      parameters: identity,
      handler: async (args) => {
        find(args);
        const asksReview =
          /(?:запусти|сделай|проведи|выполни|начни|запустить|run|start|perform|do).{0,80}(?:ревью|review)|(?:проверь|отревьюй|review)\s+(?:этот\s+)?(?:pr\b|pull|пул|#?\d)/iu.test(
            prompt,
          );
        const deniesReview =
          /(?:не|не надо|не нужно)\s+(?:делать|делай|запускай|запускать|провер|ревью)|do not|don't/iu.test(
            prompt,
          );
        if (!asksReview || deniesReview)
          throw new AppError(
            403,
            "Для запуска ревью нужна явная просьба в текущем сообщении пользователя.",
          );
        const id = service.requestReview(args.monitor, args.repo, args.number);
        const job = store.db
          .prepare("SELECT id,status,error FROM pr_reviews WHERE id=?")
          .get(id);
        return {
          job,
          azureChanged: false,
          note: "queued означает очередь, не готовый результат. Ревью начнётся после завершения чата при наличии дневного лимита. awaiting_answers означает, что нужно ответить на все вопросы во Входящих; не ставьте новые задачи вместо ответов. Результат сохраняется на странице Pull requests.",
        };
      },
    }),
  ];
}
