export type PrCount = { value: number; complete: boolean };
export async function countPrCommits(load: (token: string) => Promise<{ body: any; continuationToken: string }>): Promise<PrCount> {
  const ids = new Set<string>(), tokens = new Set<string>();
  let token = "";
  for (let page = 0; page < 20; page++) {
    const result = await load(token);
    if (!Array.isArray(result.body?.value) || result.body.value.some((c: any) => typeof c.commitId !== "string" || !c.commitId)) throw new Error("Azure не вернул список коммитов");
    for (const commit of result.body.value) ids.add(commit.commitId);
    if (!result.continuationToken) return { value: ids.size, complete: true };
    if (tokens.has(result.continuationToken)) throw new Error("Azure повторил страницу коммитов");
    token = result.continuationToken; tokens.add(token);
  }
  return { value: ids.size, complete: false };
}
export async function countPrFiles(load: (skip: number) => Promise<any>): Promise<PrCount> {
  const paths = new Set<string>(), seen = new Set<string>();
  let skip = 0, base: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await load(skip);
    if (!Array.isArray(result.changes) || !result.commonCommit || (base && base !== result.commonCommit)) throw new Error("Azure не вернул стабильный список изменений");
    base = result.commonCommit;
    for (const change of result.changes) if (change.item?.path && !change.item.isFolder) paths.add(change.item.path);
    if (result.allChangesIncluded === true) return { value: paths.size, complete: true };
    const signature = JSON.stringify(result.changes);
    if (!result.changes.length || seen.has(signature)) throw new Error("Azure не вернул следующую страницу изменений");
    seen.add(signature); skip += result.changes.length;
  }
  return { value: paths.size, complete: false };
}
