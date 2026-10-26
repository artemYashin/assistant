import type { ContentLink } from "../../../features/render-content/index.js";
import { findCitationRange } from "../../../entities/ticket/index.js";

/** Reveal the stored source, not another occurrence of the same text in the link list. */
export function locateContentLink(
  root: HTMLElement,
  link: ContentLink,
  base: string,
): Range | null {
  const source = [...root.querySelectorAll<HTMLElement>("[data-link-source]")].find(
    (element) => element.dataset.linkSource === link.source,
  );
  if (!source) return null;
  for (let element: HTMLElement | null = source; element; element = element.parentElement) {
    if (element instanceof HTMLDetailsElement) element.open = true;
    if (element === root) break;
  }
  const anchor = [...source.querySelectorAll<HTMLAnchorElement>("a[href]")].find((element) => {
    try {
      return (
        new URL(element.getAttribute("href")!, base.endsWith("/") ? base : base + "/").href ===
        link.url
      );
    } catch {
      return false;
    }
  });
  if (anchor) {
    const range = document.createRange();
    range.selectNodeContents(anchor);
    return range;
  }
  return findCitationRange(source, link.quote || link.label);
}
