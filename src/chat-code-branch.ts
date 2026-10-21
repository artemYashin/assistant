export function chatCodeBranch(value: string) {
  if (!value.startsWith("/code?")) return null;
  const params = new URLSearchParams(value.slice(6));
  const branch = params.get("branch"), client = params.get("client"), project = params.get("project");
  if (!branch || branch.length > 500 || /[\r\n\0]/.test(branch) || !client || !project || client.length > 200 || project.length > 200) return null;
  const path = params.get("path");
  const label = params.get("label") || undefined;
  if (label && (label.length > 200 || /[\r\n\0]/.test(label))) return null;
  const startLine = Number(params.get("line") || 1), endLine = Number(params.get("endLine") || startLine);
  if (path !== null && (!path || path.length > 4096 || path.startsWith("/") || /[\\\r\n\0]/.test(path) || path.split("/").some(part => part === ".." || part === "." || !part) || !Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(endLine) || endLine < startLine)) return null;
  if (path) return { branch, client, project, path, label, startLine, endLine, href: `/code?${new URLSearchParams({ client, project, branch, path, ...(label ? { label } : {}), line: String(startLine), endLine: String(endLine) })}` };
  return { branch, client, project, path: undefined, label: undefined, startLine: undefined, endLine: undefined, href: `/code?${new URLSearchParams({ client, project, branch })}` };
}
