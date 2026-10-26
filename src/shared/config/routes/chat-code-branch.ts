export function chatCodeBranch(value: string) {
  if (!value.startsWith("/code?")) return null;
  const params = new URLSearchParams(value.slice(6));
  const branch = params.get("branch"), client = params.get("client"), project = params.get("project");
  if (!branch || branch.length > 500 || /[\r\n\0]/.test(branch) || !client || !project || client.length > 200 || project.length > 200) return null;
  const revision = params.get("revision") || undefined;
  if (revision && !/^[0-9a-f]{40,64}$/.test(revision)) return null;
  const path = params.get("path");
  const label = params.get("label") || undefined;
  if (label && (label.length > 200 || /[\r\n\0]/.test(label))) return null;
  const startLine = Number(params.get("line") || 1), endLine = Number(params.get("endLine") || startLine);
  if (path !== null && (!path || path.length > 4096 || path.startsWith("/") || /[\\\r\n\0]/.test(path) || path.split("/").some(part => part === ".." || part === "." || !part) || !Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(endLine) || endLine < startLine)) return null;
  if (path) return { revision, branch, client, project, path, label, startLine: params.has("line") || params.has("endLine") ? startLine : undefined, endLine: params.has("line") || params.has("endLine") ? endLine : undefined, href: `/code?${new URLSearchParams({ client, project, branch, ...(revision ? { revision } : {}), path, ...(label ? { label } : {}), ...(params.has("line") || params.has("endLine") ? { line: String(startLine), endLine: String(endLine) } : {}) })}` };
  return { revision, branch, client, project, path: undefined, label: undefined, startLine: undefined, endLine: undefined, href: `/code?${new URLSearchParams({ client, project, branch, ...(revision ? { revision } : {}) })}` };
}
