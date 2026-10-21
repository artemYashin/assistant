import type { Root, RootContent } from "mdast";
import { chatTicketCitation } from "./routing.js";

/** Keep an existing quote and its standalone original-link paragraph in one card. */
export function remarkTicketCitations() {
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      if (!("children" in node)) return;
      const children = node.children;
      for (let index = 0; index < children.length; index++) {
        const quote = children[index], next = children[index + 1];
        if (quote.type === "blockquote" && next?.type === "paragraph") {
          const meaningful = next.children.filter(child => child.type !== "text" || child.value.trim());
          if (meaningful.length && meaningful.every(child => child.type === "link" && chatTicketCitation(child.url))) {
            quote.children.push(next);
            children.splice(index + 1, 1);
          }
        }
        visit(quote as RootContent);
      }
    };
    visit(tree);
  };
}
