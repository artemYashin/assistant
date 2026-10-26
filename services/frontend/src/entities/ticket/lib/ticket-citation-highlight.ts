type Point = { node: Text; offset: number };

/** Keep offsets into the rendered DOM so inline formatting never splits a citation. */
export function findCitationRange(root: HTMLElement, quote: string): Range | null {
  let text = "";
  const starts: (Point | null)[] = [],
    ends: (Point | null)[] = [];
  const append = (character: string, start: Point | null, end: Point | null) => {
    if (/[*_`]/.test(character)) return;
    if (/\s/.test(character)) {
      if (!text || text.endsWith(" ")) return;
      character = " ";
    }
    text += character;
    starts.push(start);
    ends.push(end);
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || "";
      for (let offset = 0; offset < value.length; offset++)
        append(
          value[offset],
          { node: node as Text, offset },
          { node: node as Text, offset: offset + 1 },
        );
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.matches("summary, button, script, style, [aria-hidden='true'], .image-thumbnail"))
      return;
    const block = node.matches("p, div, li, td, th, tr, blockquote, h1, h2, h3, h4, pre, br");
    if (block) append(" ", null, null);
    node.childNodes.forEach(walk);
    if (block) append(" ", null, null);
  };
  walk(root);
  const normalized = quote.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const index = text.indexOf(normalized);
  if (index < 0) return null;
  const start = starts[index],
    end = ends[index + normalized.length - 1];
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

export function revealCitation(range: Range) {
  // Scroll each nested viewport to the actual text, not its paragraph's top edge.
  let element = range.startContainer.parentElement;
  while (element) {
    const style = getComputedStyle(element);
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) {
      const text = range.getClientRects()[0];
      if (text) {
        const viewport = element.getBoundingClientRect();
        element.scrollTop +=
          text.top - viewport.top - element.clientTop - (element.clientHeight - text.height) / 2;
      }
    }
    element = element.parentElement;
  }
}

export function highlightCitation(range: Range) {
  const api = window as unknown as {
    Highlight?: new (...ranges: Range[]) => unknown;
    CSS?: { highlights?: Map<string, unknown> };
  };
  const name = "ticket-citation";
  if (api.Highlight && api.CSS?.highlights) {
    const highlight = new api.Highlight(range);
    const registry = api.CSS.highlights;
    registry.set(name, highlight);
    return () => {
      if (registry.get(name) === highlight) registry.delete(name);
    };
  }
  // Older browsers can still reveal the exact text without rewriting React's DOM.
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return () => {
    if (selection?.rangeCount && selection.getRangeAt(0) === range) selection.removeAllRanges();
  };
}
