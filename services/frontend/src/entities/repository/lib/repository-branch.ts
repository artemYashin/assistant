type Context = { client: string; project: string };
export const repositoryBranchKey = (context: Context) =>
  "repository-branch:" + JSON.stringify({ client: context.client, project: context.project });
export function currentRepositoryBranch(context: Context): string | undefined {
  try {
    return sessionStorage.getItem(repositoryBranchKey(context)) || undefined;
  } catch {
    return undefined;
  }
}
