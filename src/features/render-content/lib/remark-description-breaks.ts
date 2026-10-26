import type { Root, RootContent } from "mdast";

// Azure descriptions treat a single newline as a visible line break.
// Work on Markdown nodes so code blocks and inline code stay untouched.
export function remarkDescriptionBreaks() {
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      if (!("children" in node)) return;
      const children: RootContent[] = [];
      for (const child of node.children) {
        if (child.type === "text") {
          child.value.split(/\r\n|\n|\r/).forEach((value, index) => {
            if (index) children.push({ type: "break" });
            if (value) children.push({ type: "text", value });
          });
        } else if (child.type === "html" && /^<br\s*\/?\s*>$/i.test(child.value.trim())) {
          // Allow only a plain line break; arbitrary HTML remains skipped.
          children.push({ type: "break" });
        } else {
          visit(child);
          children.push(child);
        }
      }
      node.children = children as typeof node.children;
    };
    visit(tree);
  };
}
