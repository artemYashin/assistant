import { remarkTicketCitations } from "./remark-ticket-citations.js";
import { ImagePreview } from "./ImagePreview.js";
import { Link } from "react-router-dom";
import { ArrowUpRight, Quote, Figma, Github, Cloud, Link2 } from "lucide-react";
import { chatTicketCitation, chatTicketPath } from "./routing.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkDescriptionBreaks } from "./remark-description-breaks.js";

const ticketAsset = (url: string) => /^\/api\/ticket-cards\/[a-zA-Z0-9-]+\/attachments\/[0-9a-f-]{36}$/i.test(url);

function ExternalLinkIcon({ href }: { href: string }) {
  let host = "";
  try { host = new URL(href).hostname.toLowerCase(); } catch { /* Non-HTTP links use the generic icon. */ }
  const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  const brand = matches("figma.com") ? "figma" : matches("github.com") ? "github" : matches("dev.azure.com") || matches("visualstudio.com") || matches("azure.com") ? "azure" : "generic";
  const Icon = brand === "figma" ? Figma : brand === "github" ? Github : brand === "azure" ? Cloud : Link2;
  return <Icon size={15} className={`chat-external-icon is-${brand}`} aria-hidden="true" />;
}

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
        remarkPlugins={preserveLineBreaks ? [remarkGfm, remarkDescriptionBreaks, remarkTicketCitations] : [remarkGfm, remarkTicketCitations]}
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
          blockquote: ({ children }) => (
            <blockquote className="chat-quote-card">
              <Quote className="chat-quote-icon" size={17} aria-hidden="true" />
              {children}
            </blockquote>
          ),
          a: ({ href, children, node }) =>
            node?.children.some(
              (child) => child.type === "element" && child.tagName === "img",
            ) ? (
              <span>{children}</span>
            ) : href && chatTicketCitation(href) ? (
              <button type="button" className="chat-ticket-link" onClick={() => {
                const citation = chatTicketCitation(href)!;
                window.dispatchEvent(new CustomEvent("orbit-show-ticket-details", { detail: { source: citation.source, tickets: [{ id: citation.id, title: `#${citation.id}` }], citation } }));
              }}>Показать в тикете<ArrowUpRight size={14} aria-hidden="true" /></button>
            ) : href && chatTicketPath(href) ? (
              <Link className="chat-ticket-link" to={chatTicketPath(href)!}>
                {children}
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            ) : href ? (
              <a href={href} className="chat-external-link" title={href} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon href={href} /><span>{children}</span><ArrowUpRight size={13} className="chat-external-icon" aria-hidden="true" />
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
