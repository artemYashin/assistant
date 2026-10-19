import { unified } from "unified";
import remarkParse from "remark-parse";
import { AppError } from "./store.js";

export function descriptionImages(description: string): string[] {
  const tree = unified().use(remarkParse).parse(description);
  const definitions = new Map<string, string>();
  const images: any[] = [];
  const visit = (node: any) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
    if (node.type === "image" || node.type === "imageReference")
      images.push(node);
    node.children?.forEach(visit);
  };
  visit(tree);
  return [
    ...new Set<string>(
      images
        .map((node) => node.url || definitions.get(node.identifier))
        .filter(Boolean),
    ),
  ];
}

// Only attachment download endpoints on the configured Azure collection receive the PAT.
export function azureImageUrl(
  raw: string,
  base: string,
  prUrl: string,
  repo: string,
  number: number,
  version: string,
): string | null {
  try {
    const url = new URL(raw, prUrl);
    const root = new URL(base);
    if (
      url.protocol !== "https:" ||
      url.origin !== root.origin ||
      url.username ||
      url.password
    )
      return null;
    const path = decodeURIComponent(url.pathname);
    const prefix = decodeURIComponent(root.pathname).replace(/\/$/, "") + "/";
    if (!path.startsWith(prefix) || /[\\\x00-\x1f]/.test(path)) return null;
    const local = path.slice(prefix.length);
    const wit =
      /^(?:[^/]+\/)?_apis\/wit\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        local,
      );
    const git =
      /^(?:[^/]+\/)?_apis\/git\/repositories\/([^/]+)\/pullRequests\/(\d+)\/attachments\/([^/]+)$/i.exec(
        local,
      );
    if (
      !wit &&
      !(
        git &&
        git[1].toLowerCase() === repo.toLowerCase() &&
        Number(git[2]) === number &&
        ![".", ".."].includes(git[3])
      )
    )
      return null;
    url.search = new URLSearchParams({ "api-version": version }).toString();
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export async function readAzureImage(url: string, pat: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body)
    throw new AppError(502, "Изображение недоступно в Azure");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 20 * 1024 * 1024) {
        await reader.cancel();
        throw new AppError(413, "Изображение больше 20 МБ");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks);
  const type = body
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : body[0] === 255 && body[1] === 216 && body[2] === 255
      ? "image/jpeg"
      : ["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString())
        ? "image/gif"
        : body.subarray(0, 4).toString() === "RIFF" &&
            body.subarray(8, 12).toString() === "WEBP"
          ? "image/webp"
          : null;
  if (!type) throw new AppError(415, "Поддерживаются PNG, JPEG, GIF и WebP");
  return { body, type };
}
