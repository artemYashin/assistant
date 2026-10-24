import { chatCodeBranch } from "./chat-code-branch.js";

/** Open the displayed revision, using the base side for deleted files. */
export function diffFileLink(
  file: { before: string; after: string } | undefined,
  data: { head: string; base: string } | null,
  context: { client?: string; project?: string },
  branch?: string,
) {
  if (!file || !data || !context.client || !context.project) return null;
  const deleted = file.after === "/dev/null";
  const revision = deleted ? data.base : data.head;
  if (!/^[0-9a-f]{40,64}$/.test(revision)) return null;
  const path = (deleted ? file.before : file.after).replace(/^\//, "");
  const params = new URLSearchParams({
    client: context.client, project: context.project,
    branch: branch?.replace(/^refs\/heads\//, "") || revision,
    revision, path,
  });
  return chatCodeBranch("/code?" + params)?.href ?? null;
}
