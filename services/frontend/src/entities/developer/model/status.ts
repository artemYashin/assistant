export type DeveloperGroup = "active" | "review" | "done";
export type DeveloperStatusGroups = Record<string, DeveloperGroup>;
export function developerGroup(state: string, groups: DeveloperStatusGroups): DeveloperGroup {
  const key = Object.keys(groups).find(
    (key) => key.trim().toLocaleLowerCase() === state.trim().toLocaleLowerCase(),
  );
  return key ? groups[key] : "active";
}
