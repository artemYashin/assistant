import { createElement, Fragment, useState, type ReactNode } from "react";
import { ticketText } from "./ticket-text.js";
import { ChatMarkdown } from "./ChatMarkdown.js";

function InlineImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="ticket-inline-image"
    >
      {failed ? (
        `${alt}: открыть вложение ↗`
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </a>
  );
}

export function TicketRichText({ value, card, reference }: any) {
  const raw = typeof value === "string" ? value : "";
  const preview = (source: string) => {
    try {
      const base = new URL(card.base);
      const url = new URL(source, card.base + "/");
      if (
        url.origin !== base.origin ||
        !url.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/")
      )
        return null;
      const id = /\/_apis\/wit\/attachments\/([0-9a-f-]{36})(?:$|\/)/i.exec(
        url.pathname,
      )?.[1];
      const attachment = card.attachments.find(
        (a: any) => a.id === id && a.image,
      );
      return attachment
        ? `/api/ticket-cards/${encodeURIComponent(reference)}/attachments/${encodeURIComponent(attachment.id)}`
        : null;
    } catch {
      return null;
    }
  };
  if (!/<\/?[a-z][^>]*>/i.test(raw)) {
    const images = [...raw.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => ({
      source: m[1],
      preview: preview(m[1]),
    }));
    return <ChatMarkdown text={ticketText(raw)} images={images} />;
  }
  // Parse in an inert template. Rebuild only semantic elements, never Azure's
  // layout styles, event handlers or arbitrary attributes.
  const template = document.createElement("template");
  template.innerHTML = raw;
  const blocked = new Set([
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "template",
    "noscript",
    "svg",
    "math",
  ]);
  const blocks = new Set([
    "div",
    "p",
    "section",
    "article",
    "li",
    "ul",
    "ol",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
  ]);
  const allowed = new Set([
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "del",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "p",
    "div",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "hr",
    "sup",
    "sub",
  ]);
  template.content
    .querySelectorAll([...blocked].join(","))
    .forEach((node) => node.remove());
  // Editor placeholders (including nested NBSP/BR-only paragraphs) add no content.
  [...template.content.querySelectorAll([...blocks].join(","))]
    .reverse()
    .forEach((node) => {
      if (
        !node.textContent?.replace(/[\s\u00a0]+/g, "") &&
        !node.querySelector("img,hr")
      )
        node.remove();
    });
  const renderChildren = (parent: Node, pre = false): ReactNode[] => {
    const nodes = [...parent.childNodes];
    let breaks = 0;
    return nodes.map((node, index) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent || "";
        if (pre) return value;
        if (value.trim()) breaks = 0;
        return value.replace(/[\s\u00a0]+/g, " ");
      }
      if (!(node instanceof HTMLElement)) return null;
      const tag = node.tagName.toLowerCase();
      if (tag === "br") {
        if (++breaks > 2) return null;
      } else breaks = 0;
      if (tag === "img") {
        const src = preview(node.getAttribute("src") || "");
        const alt = node.getAttribute("alt") || "Изображение";
        return src ? (
          <InlineImage key={index} src={src} alt={alt} />
        ) : (
          <span key={index}>[{alt}: предпросмотр недоступен]</span>
        );
      }
      let children: ReactNode = renderChildren(node, pre || tag === "pre");
      if (tag === "a") {
        let href: string | undefined;
        try {
          const url = new URL(node.getAttribute("href") || "", card.base + "/");
          if (["http:", "https:", "mailto:"].includes(url.protocol))
            href = url.href;
        } catch {
          /* Invalid links remain plain text. */
        }
        return href ? (
          <a key={index} href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ) : (
          <Fragment key={index}>{children}</Fragment>
        );
      }
      // Azure also represents bold/italic text with styled spans.
      if (
        node.style.fontWeight === "bold" ||
        Number(node.style.fontWeight) >= 600
      )
        children = <strong>{children}</strong>;
      if (node.style.fontStyle === "italic") children = <em>{children}</em>;
      if (!allowed.has(tag)) return <Fragment key={index}>{children}</Fragment>;
      return createElement(
        tag,
        { key: index },
        ["br", "hr"].includes(tag) ? undefined : children,
      );
    });
  };
  return (
    <div className="ticket-prose ticket-formatted">
      {renderChildren(template.content)}
    </div>
  );
}
