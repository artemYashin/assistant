import type { Root, Element } from "hast";

export const reviewText = (node: any): string =>
  node.type === "text" ? node.value : (node.children || []).map(reviewText).join("");

export function reviewSeverity(text: string) {
  const value = text.toLocaleLowerCase();
  if (/очень критич|критическ/.test(value)) return "critical";
  if (/очень низк/.test(value)) return "minimal";
  if (/высок/.test(value)) return "high";
  if (/средн/.test(value)) return "medium";
  if (/низк/.test(value)) return "low";
  return undefined;
}

// Only explicitly marked Markdown blocks are enhanced; free prose is untouched.
export function rehypeReviewFormat() {
  return (tree: Root) => {
    const visit = (node: Root | Element) => {
      for (const child of node.children) if (child.type === "element") visit(child);
      if (node.type !== "element" || node.tagName !== "blockquote") return;
      const heading = node.children.find(child => child.type === "element" && /^h[2-4]$/.test(child.tagName)) as Element | undefined;
      if (!heading || !/^(Проблема|Замечание|Улучшение)\s*:/i.test(reviewText(heading))) return;
      node.tagName = "section";
      node.properties = { ...node.properties, className: ["review-finding"] };
      heading.properties = { ...heading.properties, className: ["review-finding-title"] };
    };
    visit(tree);
    const decorate = (node: Root | Element) => {
      if (node.type === "element" && node.tagName === "strong" && /^Критичность\s*:/i.test(reviewText(node))) {
        const severity = reviewSeverity(reviewText(node));
        if (severity) node.properties = { ...node.properties, className: ["review-severity", "is-" + severity] };
      }
      // Support **Критичность:** высокая as well as **Критичность: высокая**.
      if (node.type === "element" && node.tagName === "p") {
        const label = node.children.findIndex(child => child.type === "element" && child.tagName === "strong" && /^Критичность\s*:\s*$/i.test(reviewText(child)));
        const value = node.children[label + 1];
        if (label >= 0 && value?.type === "text") {
          const actual = /^(\s*)(очень критичная|критическая|очень низкая|высокая|средняя|низкая)(?=\s|[.,;:—–-]|$)/i.exec(value.value);
          if (actual) node.children.splice(label + 1, 1,
            { type: "text", value: actual[1] },
            { type: "element", tagName: "span", properties: { className: ["review-severity", "is-" + reviewSeverity(actual[2])] }, children: [{ type: "text", value: actual[2] }] },
            { type: "text", value: value.value.slice(actual[0].length) });
        }
      }
      for (const child of node.children) if (child.type === "element") decorate(child);
    };
    decorate(tree);
  };
}
