export function chatCodeBranch(value: string) {
  if (!value.startsWith("/code?")) return null;
  const params = new URLSearchParams(value.slice(6));
  const branch = params.get("branch"), client = params.get("client"), project = params.get("project");
  if (!branch || branch.length > 500 || /[\r\n\0]/.test(branch) || !client || !project || client.length > 200 || project.length > 200) return null;
  return { branch, client, project, href: `/code?${new URLSearchParams({ client, project, branch })}` };
}
