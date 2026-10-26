/** Only source-qualified local PR routes can become cards. */
export function chatPrCard(value: string) {
  if (!value.startsWith("/pull-requests?")) return null;
  const params = new URLSearchParams(value.slice(value.indexOf("?") + 1));
  const monitor = params.get("monitor"),
    repo = params.get("repo"),
    number = params.get("number");
  if (
    !monitor ||
    !repo ||
    !number ||
    !/^[1-9]\d*$/.test(number) ||
    !Number.isSafeInteger(Number(number)) ||
    params.get("card") !== "pr"
  )
    return null;
  return {
    number,
    title: (params.get("title") || `PR #${number}`).slice(0, 500),
    author: (params.get("author") || "Автор не указан").slice(0, 200),
    createdAt: params.get("createdAt") || "",
    href: `/pull-requests?${new URLSearchParams({ monitor, repo, number })}`,
  };
}
