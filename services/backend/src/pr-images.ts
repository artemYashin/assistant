import { shortTicketAttachmentId } from "./ticket-attachment-url.js";
import { azureImageOriginAllowed } from "./azure-image-origin.js";
import { createHash } from "node:crypto";
import { ticketInlineImages } from "./ticket-inline-images.js";
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
    if (node.type === "image" || node.type === "imageReference") images.push(node);
    node.children?.forEach(visit);
  };
  visit(tree);
  return [
    ...new Set<string>(
      images.map((node) => node.url || definitions.get(node.identifier)).filter(Boolean),
    ),
  ];
}

// Read-time adaptation only: keep original descriptions in SQLite and exact-preview snapshots.
export function prDescriptionImages(description: string) {
  const tree = unified().use(remarkParse).parse(description);
  const definitions = new Map<string, any>();
  const nodes: any[] = [];
  const html: any[] = [];
  const visit = (node: any) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if (node.type === "image" || node.type === "imageReference") nodes.push(node);
    if (node.type === "html") html.push(node);
    node.children?.forEach(visit);
  };
  visit(tree);
  const replacements: { start: number; end: number; text: string }[] = [];
  const sources = new Set<string>();
  const inline = new Map<string, { body: Buffer; type: string }>();
  const rawSources = nodes
    .map((node) => node.url || definitions.get(node.identifier)?.url)
    .filter(Boolean);
  const htmlImages: { start: number; end: number; source: string }[] = [];
  for (const node of html) {
    // Do not extract pseudo-markup inside raw script/style/comment contents.
    if (/<(?:script|style|textarea|pre|code)\b|<!--/i.test(node.value)) continue;
    for (const match of node.value.matchAll(/<img\b[^>]*>/gi)) {
      const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
      const source = src?.[1] ?? src?.[2] ?? src?.[3];
      if (!source || (!/^(?:data:image\/|blob:)/i.test(source) && !shortTicketAttachmentId(source)))
        continue;
      const start = node.position.start.offset + match.index;
      htmlImages.push({ start, end: start + match[0].length, source });
      rawSources.push(source);
    }
  }
  // Reuse ticket validation: strict base64, signature/MIME agreement, 10MB per image,
  // 20MB per description. Looking up the complete source rejects trailing junk.
  const validated = ticketInlineImages({
    fields: Object.fromEntries(rawSources.map((source, i) => [i, source])),
  });
  const mapped = (source: string) => {
    if (!/^data:image\//i.test(source)) {
      sources.add(source);
      return source;
    }
    const image = validated.get(source);
    const id = image?.id || "unavailable-" + createHash("sha256").update(source).digest("hex");
    const marker = `https://orbit.invalid/pr-inline-image/${id}`;
    if (image) inline.set(marker, { body: image.body, type: image.type });
    sources.add(marker);
    return marker;
  };
  for (const node of nodes) {
    const source = node.url || definitions.get(node.identifier)?.url;
    if (!source) continue;
    const replacement = mapped(source);
    if (replacement !== source)
      replacements.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
        text: `![Изображение](${replacement})`,
      });
  }
  for (const node of html) {
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    const contained = htmlImages.filter((image) => image.start >= start && image.end <= end);
    if (!contained.length) continue;
    let text = node.value;
    for (const image of contained.sort((a, b) => b.start - a.start))
      text =
        text.slice(0, image.start - start) +
        `\n\n![Изображение](${mapped(image.source)})\n\n` +
        text.slice(image.end - start);
    // HTML wrappers would otherwise cause Markdown to hide the converted image.
    // Keep their text, never forward attributes or enable raw HTML rendering.
    text = text.replace(/<[^>]*>/g, "\n");
    replacements.push({ start, end, text });
  }
  // Keep shared text-link definitions valid while replacing their embedded payloads.
  for (const definition of definitions.values()) {
    if (!rawSources.includes(definition.url) || !/^data:image\//i.test(definition.url)) continue;
    replacements.push({
      start: definition.position.start.offset,
      end: definition.position.end.offset,
      text: description
        .slice(definition.position.start.offset, definition.position.end.offset)
        .replace(definition.url, mapped(definition.url)),
    });
  }
  let rendered = description;
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    rendered =
      rendered.slice(0, replacement.start) + replacement.text + rendered.slice(replacement.end);
  return { description: rendered, sources: [...sources], inline };
}

// Only attachment download endpoints on the configured Azure collection receive the PAT.
export function azureImageUrl(
  raw: string,
  base: string,
  prUrl: string,
  repo: string,
  number: number,
  version: string,
  aliases: { repositories?: string[]; projects?: string[] } = {},
): string | null {
  try {
    const root = new URL(base);
    const shortId = shortTicketAttachmentId(raw);
    const url = new URL(
      shortId ? `${base.replace(/\/$/, "")}/_apis/wit/attachments/${shortId}` : raw,
      prUrl,
    );
    if (url.protocol !== "https:" || !azureImageOriginAllowed(url, root)) return null;
    const path = decodeURIComponent(url.pathname);
    const prefix = decodeURIComponent(root.pathname).replace(/\/$/, "") + "/";
    // eslint-disable-next-line no-control-regex -- Remove control bytes from untrusted input/output.
    if (!path.startsWith(prefix) || /[\\\x00-\x1f]/.test(path)) return null;
    const local = path.slice(prefix.length);
    const wit =
      /^(?:[^/]+\/)?_apis\/wit\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        local,
      );
    const git =
      /^(?:([^/]+)\/)?_apis\/git\/repositories\/([^/]+)\/pullRequests\/(\d+)\/attachments\/([^/]+)$/i.exec(
        local,
      );
    const currentProject = decodeURIComponent(new URL(prUrl).pathname)
      .slice(prefix.length)
      .split("/_git/")[0];
    const projects = [currentProject, ...(aliases.projects || [])].map((s) => s.toLowerCase());
    const repositories = [repo, ...(aliases.repositories || [])].map((s) => s.toLowerCase());
    if (
      !wit &&
      !(
        git &&
        (!git[1] || projects.includes(git[1].toLowerCase())) &&
        repositories.includes(git[2].toLowerCase()) &&
        Number(git[3]) === number &&
        ![".", ".."].includes(git[4])
      )
    )
      return null;
    // MCAS is an input alias only; never send credentials to the browser proxy.
    url.hostname = root.hostname;
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
  if (!response.ok || !response.body) throw new AppError(502, "Изображение недоступно в Azure");
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
  const type = body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : body[0] === 255 && body[1] === 216 && body[2] === 255
      ? "image/jpeg"
      : ["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString())
        ? "image/gif"
        : body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP"
          ? "image/webp"
          : null;
  if (!type) throw new AppError(415, "Поддерживаются PNG, JPEG, GIF и WebP");
  return { body, type };
}
