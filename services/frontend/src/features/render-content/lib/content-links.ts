import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

export type ContentLink = { url: string; label: string };
export type LinkContent = { value: unknown; markdown?: boolean };
const parser = unified().use(remarkParse).use(remarkGfm);
const blocked = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "TEMPLATE",
  "NOSCRIPT",
  "SVG",
  "MATH",
  "PRE",
  "CODE",
  "IMG",
]);

/** Parse already loaded content only: no fetching, model calls or HTML execution. */
export function contentLinks(parts: LinkContent[], base: string): ContentLink[] {
  const links = new Map<string, ContentLink>();
  const add = (href: string, text: string) => {
    if (!href.trim() || href.trim().startsWith("#")) return;
    try {
      const url = new URL(href, base.endsWith("/") ? base : base + "/");
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
      // Browser-only proxies and drafts are not shareable source links.
      if (
        url.pathname.startsWith("/api/ticket-cards/") ||
        url.pathname.startsWith("/api/conversation/files/")
      )
        return;
      const label = text.replace(/\s+/g, " ").trim() || url.href;
      const previous = links.get(url.href);
      if (!previous || previous.label === previous.url)
        links.set(url.href, { url: url.href, label });
    } catch {
      /* Ignore malformed addresses. */
    }
  };
  const markdown = (value: string) => {
    const tree = parser.parse(value);
    const definitions = new Map<string, string>();
    const walk = (node: any, visit: (node: any) => void) => {
      visit(node);
      for (const child of node.children || []) walk(child, visit);
    };
    const label = (node: any): string =>
      node.alt || node.value || (node.children || []).map(label).join("");
    walk(tree, (node) => {
      if (node.type === "definition") definitions.set(node.identifier, node.url);
    });
    walk(tree, (node) => {
      if (node.type === "link" || node.type === "linkReference") {
        const href = node.url || definitions.get(node.identifier);
        if (href) add(href, label(node));
      }
    });
  };
  for (const part of parts) {
    if (typeof part.value !== "string" || !part.value.trim()) continue;
    const raw = part.value;
    const outsideCode = raw.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, "");
    if (part.markdown || !/<\/?[a-z][\w-]*(?:\s[^>]*|\/?)>/i.test(outsideCode)) {
      markdown(raw);
      continue;
    }
    // An inert template does not load images or execute scripts.
    const template = document.createElement("template");
    template.innerHTML = raw;
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        markdown(node.textContent || "");
        return;
      }
      if (node instanceof Element) {
        if (blocked.has(node.tagName)) return;
        if (node.tagName === "A") {
          const href = node.getAttribute("href");
          if (href)
            add(
              href,
              node.textContent ||
                node.getAttribute("title") ||
                node.querySelector("img")?.alt ||
                "",
            );
          return;
        }
      }
      for (const child of node.childNodes) visit(child);
    };
    visit(template.content);
  }
  return [...links.values()];
}
