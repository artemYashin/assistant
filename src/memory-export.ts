export type MemoryScope = "general" | "client" | "project";
export type ExportMemory = { scope: MemoryScope; body: string; summary?: string; id?: string; client: string; project: string };
export const memoryScopeLabels = { general: "General memory", client: "Customer memory", project: "Project memory" };
export function memoryMarkdownFiles(rows: ExportMemory[], scopes: MemoryScope[], separate: boolean, context: { client: string; project: string }, includeContext = true) {
  const plain = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}\[\]<>#!|]/g, "\\$&");
  const groups = (["general", "client", "project"] as MemoryScope[]).filter(scope => scopes.includes(scope)).flatMap(scope => {
    const entries = rows.filter(row => row.scope === scope && (scope === "general" || row.client === context.client) && (scope !== "project" || row.project === context.project));
    if (!entries.length) return [];
    const metadata = includeContext && scope !== "general" ? `\nCustomer: ${plain(context.client)}\n${scope === "project" ? `\nProject: ${plain(context.project)}\n` : ""}` : "";
    return [{ scope, text: `## ${memoryScopeLabels[scope]}\n${metadata}\n${entries.map(entry => `${entry.summary ? `### ${plain(entry.summary)}\n\n` : ""}${entry.id ? `Memory ID: ${entry.id}\n\n` : ""}${entry.body.trim()}`).join("\n\n---\n\n")}\n` }];
  });
  return separate ? groups.map(group => ({ name: `orbit-memory-${group.scope}.md`, text: `# Orbit Memory\n\n${group.text}` })) : groups.length ? [{ name: "orbit-memory.md", text: `# Orbit Memory\n\n${groups.map(group => group.text).join("\n")}` }] : [];
}
