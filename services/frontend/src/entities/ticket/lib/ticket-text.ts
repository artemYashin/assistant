// Azure rich text is displayed as text only. Parse in an inert template so source
// indentation, empty editor blocks and NBSP padding do not become visual gaps.
export function ticketText(value: unknown, image?: (src: string, alt: string) => string): string {
  const raw = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  const template = document.createElement("template");
  template.innerHTML = raw;
  const preformatted: string[] = [];
  let output = "";
  const boundary = () => {
    output = output.replace(/[ \t]+$/, "");
    if (output && !output.endsWith("\n")) output += "\n";
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      output += (node.textContent || "").replace(/[\s\u00a0]+/g, " ");
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "iframe", "object", "noscript", "template"].includes(tag)) return;
    if (tag === "img") {
      output +=
        image?.(node.getAttribute("src") || "", node.getAttribute("alt") || "Изображение") || "";
      return;
    }
    if (tag === "br") {
      output += "\n";
      return;
    }
    if (tag === "pre") {
      boundary();
      const index = preformatted.push((node.textContent || "").replace(/\r\n?/g, "\n")) - 1;
      output += `\uE000${index}\uE001`;
      boundary();
      return;
    }
    const block = [
      "p",
      "div",
      "section",
      "article",
      "blockquote",
      "li",
      "ul",
      "ol",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "tr",
    ].includes(tag);
    if (block) boundary();
    node.childNodes.forEach(visit);
    if (tag === "td" || tag === "th") output += " ";
    if (block) boundary();
  };
  // Preserve intentional line breaks/indentation in plain-text fields.
  if (
    !/<\/?(?:p|div|br|span|pre|code|strong|b|em|i|a|img|ul|ol|li|h[1-6]|table|tr|td|th|section|article|blockquote|script|style|iframe|object)\b/i.test(
      raw,
    )
  ) {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = raw;
    return decoder.value
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
      .trim();
  }
  template.content.childNodes.forEach(visit);
  return output
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/\uE000(\d+)\uE001/g, (_, index) => preformatted[Number(index)] ?? "");
}
