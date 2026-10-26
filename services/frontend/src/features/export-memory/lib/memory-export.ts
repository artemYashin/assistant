export type MemoryScope = "general" | "client" | "project" | "project_review";
export type ExportMemory = {
  scope: MemoryScope;
  body: string;
  summary?: string;
  id?: string;
  client: string;
  project: string;
};
export const memoryScopeLabels = {
  general: "General memory",
  client: "Customer memory",
  project: "Project memory",
  project_review: "Project review memory",
};
export function memoryMarkdownFiles(
  rows: ExportMemory[],
  scopes: MemoryScope[],
  separate: boolean,
  context: { client: string; project: string },
  includeContext = true,
  splitDetails = false,
) {
  const details: { name: string; text: string }[] = [];
  const plain = (value: string) =>
    value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]<>#!|]/g, "\\$&");
  const groups = (["general", "client", "project", "project_review"] as MemoryScope[])
    .filter((scope) => scopes.includes(scope))
    .flatMap((scope) => {
      const entries = rows.filter(
        (row) =>
          row.scope === scope &&
          (scope === "general" || row.client === context.client) &&
          (!["project", "project_review"].includes(scope) || row.project === context.project),
      );
      if (!entries.length) return [];
      const metadata =
        includeContext && scope !== "general"
          ? `\nCustomer: ${plain(context.client)}\n${["project", "project_review"].includes(scope) ? `\nProject: ${plain(context.project)}\n` : ""}`
          : "";
      const content = entries
        .map((entry, index) => {
          if (!splitDetails)
            return `${entry.summary ? `### ${plain(entry.summary)}\n\n` : ""}${entry.id ? `Memory ID: ${entry.id}\n\n` : ""}${entry.body.trim()}`;
          const title = plain(entry.summary?.trim() || `Memory ${index + 1}`);
          const name = `details/${scope}-${String(index + 1).padStart(3, "0")}.md`;
          const overview = separate ? `orbit-memory-${scope}.md` : "orbit-memory.md";
          details.push({
            name,
            text: `# ${title}\n\n${entry.id ? `Memory ID: ${plain(entry.id)}\n\n` : ""}${entry.body.trim()}\n\n[Back to memory index](../${overview})\n`,
          });
          return `- [${title}](${name})`;
        })
        .join(splitDetails ? "\n" : "\n\n---\n\n");
      return [{ scope, text: `## ${memoryScopeLabels[scope]}\n${metadata}\n${content}\n` }];
    });
  const indexes = separate
    ? groups.map((group) => ({
        name: `orbit-memory-${group.scope}.md`,
        text: `# Orbit Memory\n\n${group.text}`,
      }))
    : groups.length
      ? [
          {
            name: "orbit-memory.md",
            text: `# Orbit Memory\n\n${groups.map((group) => group.text).join("\n")}`,
          },
        ]
      : [];
  return [...indexes, ...details];
}
