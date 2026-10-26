import { z } from "zod";
export const reviewFileSettings = z.object({
  ignoredPaths: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  diffBudget: z.number().int().min(40000).max(400000).default(160000),
});
/** Root-relative glob: * excludes slash; ** includes slash; trailing slash means directory. */
export function ignoredReviewPath(path: string, patterns: string[]) {
  const value = path.replace(/^\/+/, "");
  return patterns.some((raw) => {
    let pattern = raw.replace(/^\.\//, "").replace(/^\/+/, "");
    if (pattern.endsWith("/")) pattern += "**";
    const tokens: string[] = [];
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === "*" && pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          tokens.push("**/");
          i++;
        } else tokens.push("**");
      } else tokens.push(pattern[i]);
    }
    let prev = Array(value.length + 1).fill(false);
    prev[0] = true;
    for (const token of tokens) {
      const next = Array(value.length + 1).fill(false);
      if (token === "*" || token === "**" || token === "**/") {
        next[0] = prev[0];
        let reachable = prev[0];
        for (let j = 1; j <= value.length; j++) {
          if (token === "**/") {
            next[j] = prev[j] || (reachable && value[j - 1] === "/");
            reachable ||= prev[j];
          } else next[j] = prev[j] || (next[j - 1] && (token === "**" || value[j - 1] !== "/"));
        }
      } else
        for (let j = 1; j <= value.length; j++)
          next[j] =
            prev[j - 1] && (token === value[j - 1] || (token === "?" && value[j - 1] !== "/"));
      prev = next;
    }
    return prev[value.length];
  });
}
