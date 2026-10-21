import { remarkTicketCitations } from "./remark-ticket-citations.js";
import { ImagePreview } from "./ImagePreview.js";
import { useState, type ReactNode } from "react";
import { azureTicketPath, shareTicketUrl } from "./azure-ticket-link.js";
import { Copy, Check, ArrowUpRight, Quote, Figma, Github, Cloud, Link2 } from "lucide-react";
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

function CopyableLink({ href, children }: { href: string; children: ReactNode }) {
  const [status, setStatus] = useState("");
  return <span className="chat-copyable-link">{children}<button type="button" className="chat-link-copy" title={status || "Скопировать ссылку"} aria-label={status || "Скопировать ссылку"} onClick={async () => {
    try {
      await navigator.clipboard.writeText(shareTicketUrl(href));
      setStatus("Скопировано");
    } catch { setStatus("Не удалось скопировать ссылку"); }
  }}>{status === "Скопировано" ? <Check size={13} /> : <Copy size={13} />}<span className="chat-copy-feedback" role="status">{status}</span></button></span>;
}

export function ChatMarkdown({
  text,
  images,
  azureSource,
  preserveLineBreaks = false,
}: {
  text: string;
  azureSource?: string;
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
          a: ({ href, children, node }) => {
            if (node?.children.some(child => child.type === "element" && child.tagName === "img")) return <span>{children}</span>;
            if (!href) return <span>{children}</span>;
            const citation = chatTicketCitation(href);
            const local = chatTicketPath(href) || azureTicketPath(href, azureSource);
            if (local) {
              const params = new URLSearchParams(local.split("?")[1]);
              return <CopyableLink href={href}><a className="chat-ticket-link" href={local} onClick={event => {
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                const id = Number(params.get("id"));
                window.dispatchEvent(new CustomEvent("orbit-show-ticket-details", { detail: { source: params.get("source"), tickets: [{ id, title: `#${id}` }], ...(citation ? { citation } : {}) } }));
              }}>{citation ? "Показать в тикете" : children}<ArrowUpRight size={14} aria-hidden="true" /></a></CopyableLink>;
            }
            return <CopyableLink href={href}><a href={href} className="chat-external-link" title={href} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon href={href} /><span>{children}</span><ArrowUpRight size={13} className="chat-external-icon" aria-hidden="true" />
            </a></CopyableLink>;
          },
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
