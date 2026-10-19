import { Fragment, useState } from "react";
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
  if (!/<(?:div|p|span|img|br|table|ul|ol|pre)\b/i.test(raw)) {
    const images = [...raw.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => ({
      source: m[1],
      preview: preview(m[1]),
    }));
    return images.length ? (
      <ChatMarkdown text={raw} images={images} />
    ) : (
      <p className="ticket-prose">{ticketText(raw)}</p>
    );
  }
  const images: { src: string | null; alt: string }[] = [];
  // A per-render marker cannot collide with text supplied by Azure.
  const marker = `orbit-image-${crypto.randomUUID()}-`;
  const content = ticketText(raw, (source, alt) => {
    const index = images.push({ src: preview(source), alt }) - 1;
    return `${marker}${index}${marker}`;
  });
  const parts = content.split(new RegExp(`${marker}(\\d+)${marker}`));
  return (
    <div className="ticket-prose">
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const image = images[Number(part)];
        return image.src ? (
          <InlineImage key={image.src + i} src={image.src} alt={image.alt} />
        ) : (
          <span key={i}>[{image.alt}: предпросмотр недоступен]</span>
        );
      })}
    </div>
  );
}
