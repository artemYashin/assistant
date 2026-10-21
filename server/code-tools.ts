import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { CodeBrowser } from "./code-browser.js";
import { AppError, type Store, type Context } from "./store.js";

const branch = z.string().min(1).max(500);
const path = z.string().max(4096);
const page = { offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(40).default(15) };
export function codeTools(store: Store, context: Context, assertActive: () => void, browser = new CodeBrowser(store)) {
  if (!store.settings().assistantCodeAccess) return [];
  const revisions = new Map<string, string>();
  const read = async (operation: string, args: Record<string, unknown>) => {
    assertActive();
    if (!store.settings().assistantCodeAccess) throw new AppError(403, "Доступ ассистента к коду отключён в настройках.");
    if (!context.client || !context.project) throw new AppError(400, "Выберите заказчика и проект.");
    const name = String(args.branch || "");
    const data = await browser.request({ ...args, ...context, operation, localOnly: true, localReadWaitMs: store.settings().assistantCodeWaitSeconds * 1000, refresh: false, ...(revisions.has(name) ? { revision: revisions.get(name) } : {}) });
    assertActive();
    if (data.sha) revisions.set(name, data.sha);
    return data;
  };
  const paged = (data: any, key: string, offset: number, limit: number) => {
    const items: any[] = [];
    for (const item of data[key].slice(0, limit)) {
      if (items.length && JSON.stringify([...items, item]).length > 12000) break;
      items.push(item);
    }
    const more = data.more || data[key].length > items.length;
    return { sha: data.sha, [key]: items, total: data.total, nextOffset: more ? offset + items.length : null, ...(data.coverage ? { coverage: data.coverage, perFileLimit: data.perFileLimit } : {}) };
  };
  return [
    defineTool("show_code_branches", {
      description: "Show compact clickable branch buttons in chat. Returns exact localUrl for each cached branch; render each as a Markdown link. Copy button is provided by UI. No network. Paginate or filter names.",
      parameters: z.object({ ...page, search: z.string().max(200).default("") }),
      handler: async ({ offset, limit, search }) => {
        const data = await read("branches", {});
        const names = data.branches.filter((name: string) => name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
        return { branches: names.slice(offset, offset + limit).map((branch: string) => ({ branch, localUrl: `/code?${new URLSearchParams({ ...context, branch })}` })), nextOffset: offset + limit < names.length ? offset + limit : null, total: names.length, catalogTruncated: data.more };
      },
    }),
    defineTool("code_work_status", {
      description: "Inspect current Git preparation/download/search jobs and queue for the current repository. Read-only, does not wait behind downloads or initiate synchronization. Empty jobs means idle, not proof that a branch is downloaded.",
      parameters: z.object({}),
      handler: async () => read("jobs", {}),
    }),
    defineTool("code_branches", {
      description: "List cached branch names for the current project's repository. No network fetch. Choose the relevant branch, clarify ambiguity; listed branches may not have been downloaded yet.",
      parameters: z.object({ ...page }),
      handler: async ({ offset, limit }) => {
        const data = await read("branches", {});
        return { repository: data.repository, defaultBranch: data.defaultBranch, branches: data.branches.slice(offset, offset + limit), nextOffset: offset + limit < data.branches.length ? offset + limit : null, checkedAt: data.checkedAt, catalogTruncated: data.more };
      },
    }),
    defineTool("code_tree", {
      description: "List one directory of a local repository snapshot. Returns names, paths, types and sizes; no file bodies. Paginated.",
      parameters: z.object({ branch, path: path.default(""), ...page }),
      handler: async ({ limit, ...args }) => paged(await read("tree", args), "entries", args.offset, limit),
    }),
    defineTool("code_search", {
      description: "Find files by literal path/name substring (mode=name) or grep literal code text (mode=content), case-insensitive. Returns short line-numbered context, not whole files. No shell/regex execution, no network. Read coverage and perFileLimit; paginate nextOffset. Search several specific terms when needed.",
      parameters: z.object({ branch, query: z.string().trim().min(1).max(200), mode: z.enum(["name", "content"]).default("content"), ...page }),
      handler: async ({ limit, ...args }) => paged(await read("search", args), "results", args.offset, limit),
    }),
    defineTool("code_read_file", {
      description: "Read a local file with line numbers. Default 80 lines from startLine; set endLine for a range, or full=true for the complete file (large files still paginated by nextLine). Prefer relevant snippets, but read full files when it reduces repeated calls or improves accuracy. Binary/oversized files may be unavailable; symlinks are not followed. No writes/network.",
      parameters: z.object({ branch, path: path.min(1), startLine: z.number().int().min(1).default(1), endLine: z.number().int().min(1).optional(), full: z.boolean().default(false) }),
      handler: async ({ startLine, endLine, full, ...args }) => {
        if (endLine !== undefined && endLine < startLine) throw new AppError(400, "endLine должен быть не меньше startLine");
        const data = await read("file", args);
        if (data.unavailable) return { sha: data.sha, path: args.path, unavailable: data.unavailable };
        const lines = String(data.text).split(/\r?\n/);
        const end = Math.min(lines.length, endLine ?? (full ? lines.length : startLine + 79));
        const result: { line: number; text: string; truncated?: boolean }[] = [];
        let size = 0;
        for (let index = startLine - 1; index < end; index++) {
          const text = lines[index];
          const item = { line: index + 1, text: text.slice(0, 10000), ...(text.length > 10000 ? { truncated: true } : {}) };
          while (JSON.stringify(item).length > 13000) { item.text = item.text.slice(0, Math.floor(item.text.length * 0.8)); item.truncated = true; }
          const bytes = JSON.stringify(item).length;
          if (result.length && size + bytes > 14000) break;
          result.push(item); size += bytes;
        }
        const last = result.at(-1)?.line ?? startLine - 1;
        return { sha: data.sha, path: args.path, totalLines: lines.length, lines: result, nextLine: result.length && last < end ? last + 1 : null, symlink: data.symlink, lfs: data.lfs };
      },
    }),
  ];
}
