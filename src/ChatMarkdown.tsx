import { ImagePreview } from "./ImagePreview.js";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { chatTicketCitation, chatTicketPath } from "./routing.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkDescriptionBreaks } from "./remark-description-breaks.js";

const ticketAsset = (url: string) => /^\/api\/ticket-cards\/[a-zA-Z0-9-]+\/attachments\/[0-9a-f-]{36}$/i.test(url);

export function ChatMarkdown({
  text,
  images,
  preserveLineBreaks = false,
}: {
  text: string;
  images?: { source: string; preview: string | null }[];
  preserveLineBreaks?: boolean;
}) {
  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={preserveLineBreaks ? [remarkGfm, remarkDescriptionBreaks] : [remarkGfm]}
        skipHtml
        urlTransform={(url, key) =>
          ticketAsset(url) || (key === "href" && chatTicketCitation(url)) ? url : key === "href" && chatTicketPath(url)
            ? chatTicketPath(url)!
            : key === "src" &&
                images?.some((image) => image.source === url && image.preview)
              ? url
              : /^(https?:\/\/|mailto:)/i.test(url)
                ? url
                : ""
        }
        components={{
          a: ({ href, children, node }) =>
            node?.children.some(
              (child) => child.type === "element" && child.tagName === "img",
            ) ? (
              <span>{children}</span>
            ) : href && chatTicketCitation(href) ? (
              <button type="button" className="chat-ticket-link" onClick={() => {
                const citation = chatTicketCitation(href)!;
                window.dispatchEvent(new CustomEvent("orbit-show-ticket-details", { detail: { source: citation.source, tickets: [{ id: citation.id, title: `#${citation.id}` }], citation } }));
              }}>{children}<ArrowUpRight size={14} aria-hidden="true" /></button>
            ) : href && chatTicketPath(href) ? (
              <Link className="chat-ticket-link" to={chatTicketPath(href)!}>
                {children}
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            ) : href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) => {
            if (typeof src === "string" && ticketAsset(src)) return <ImagePreview src={src} alt={alt || "Изображение"} />;
            const preview = images?.find(
              (image) => image.source === src,
            )?.preview;
            if (
              preview &&
              (preview.startsWith("/api/pr/image?") ||
                /^\/api\/ticket-cards\/[^/]+\/attachments\/[^/]+$/.test(
                  preview,
                ))
            )
              return (
                <ImagePreview
                  key={preview}
                  src={preview}
                  alt={alt}
                  className="pr-image-link"
                />
              );
            return typeof src === "string" && /^https?:\/\//i.test(src) ? (
              <ImagePreview
                src={src}
                alt={alt || "Изображение"}
                thumbnail={true}
              />
            ) : (
              <span>{alt || "Изображение"}</span>
            );
          },
          table: ({ children }) => (
            <div className="chat-markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
