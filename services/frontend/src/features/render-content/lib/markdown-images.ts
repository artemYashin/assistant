import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm);

/** Match the Markdown renderer: resolve titles, angle destinations and references. */
export function markdownImageSources(text: string): string[] {
  const tree = parser.parse(text);
  const definitions = new Map<string, string>();
  const walk = (node: any, visit: (node: any) => void) => {
    visit(node);
    for (const child of node.children || []) walk(child, visit);
  };
  walk(tree, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });
  const sources = new Set<string>();
  walk(tree, (node) => {
    const source =
      node.type === "image"
        ? node.url
        : node.type === "imageReference"
          ? definitions.get(node.identifier)
          : undefined;
    if (typeof source === "string") sources.add(source);
  });
  return [...sources];
}
