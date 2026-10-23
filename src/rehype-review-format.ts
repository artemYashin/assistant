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

export function reviewLabelKind(text: string) {
  if (/^Критичность\s*:/i.test(text)) return "severity";
  if (/^Проблема\s*:/i.test(text)) return "problem";
  if (/^(?:Предлагаемое решение|Решение)\s*:/i.test(text)) return "solution";
  return undefined;
}
const findingHeading = (node: any): boolean => node.type === "element" && /^h[2-4]$/.test(node.tagName) && /^(Проблема|Замечание|Улучшение)\s*:/i.test(reviewText(node));

// Explicit finding headings and labels are enhanced; ordinary prose stays untouched.
export function rehypeReviewFormat() {
  return (tree: Root) => {
    // Models also use ordinary Markdown headings without a surrounding quote.
    for (let index = 0; index < tree.children.length; index++) {
      const heading = tree.children[index];
      if (heading.type !== "element" || !findingHeading(heading)) continue;
      let end = index + 1;
      while (end < tree.children.length) {
        const next = tree.children[end];
        if (next.type === "element" && /^h[1-6]$/.test(next.tagName) &&
          (findingHeading(next) || Number(next.tagName[1]) <= Number(heading.tagName[1]))) break;
        end++;
      }
      heading.properties = { ...heading.properties, className: ["review-finding-title"] };
      const children = tree.children.splice(index, end - index).filter(child => child.type !== "doctype");
      tree.children.splice(index, 0, { type: "element", tagName: "section", properties: { className: ["review-finding"] }, children });
    }
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
      // Accept explicit paragraph labels without requiring bold Markdown.
      if (node.type === "element" && node.tagName === "p") {
        const first = node.children[0];
        if (first?.type === "text") {
          const match = /^(Критичность|Проблема|Предлагаемое решение|Решение)\s*:/i.exec(first.value);
          if (match) node.children.splice(0, 1,
            { type: "element", tagName: "strong", properties: {}, children: [{ type: "text", value: match[0] }] },
            { type: "text", value: first.value.slice(match[0].length) });
        }
      }
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
