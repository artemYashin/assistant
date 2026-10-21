import { ChatCodeSnippet } from "./ChatCodeSnippet.js";
import { chatCodeBranch } from "./chat-code-branch.js";
import { chatPrCard } from "./chat-pr-card.js";
import { Link } from "react-router-dom";
import { remarkTicketCitations } from "./remark-ticket-citations.js";
import { ImagePreview } from "./ImagePreview.js";
import { useState, type ReactNode } from "react";
import { azureTicketPath, shareTicketUrl } from "./azure-ticket-link.js";
import { FileCode2, GitBranch, GitPullRequest, Copy, Check, ArrowUpRight, Quote, Figma, Github, Cloud, Link2 } from "lucide-react";
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

function CopyableLink({ href, children, ticket = false, copyValue }: { href: string; children: ReactNode; ticket?: boolean; copyValue?: string }) {
  const [status, setStatus] = useState("");
  return <span className="chat-copyable-link">{children}<button type="button" className="chat-link-copy" title={status || (copyValue ? "Скопировать имя ветки" : "Скопировать ссылку")} aria-label={status || (copyValue ? "Скопировать имя ветки" : "Скопировать ссылку")} onClick={async () => {
    try {
      await navigator.clipboard.writeText(copyValue ?? shareTicketUrl(href));
      setStatus("Скопировано");
    } catch { setStatus("Не удалось скопировать ссылку"); }
  }}>{status === "Скопировано" ? <Check size={13} /> : ticket ? <Link2 size={13} /> : <Copy size={13} />}<span className="chat-copy-feedback" role="status">{status}</span></button></span>;
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
          ticketAsset(url) || (key === "href" && (chatTicketCitation(url) || chatPrCard(url) || chatCodeBranch(url))) ? url : key === "href" && chatTicketPath(url)
            ? chatTicketPath(url)!
            : key === "src" &&
                images?.some((image) => image.source === url && image.preview)
              ? url
              : /^(https?:\/\/|mailto:)/i.test(url)
                ? url
                : ""
        }
        components={{
          pre: ({ node, children }) => {
            const code = node?.children.find(child => child.type === "element" && child.tagName === "code");
            if (code?.type !== "element") return <pre>{children}</pre>;
            const text = code.children.map(child => child.type === "text" ? child.value : "").join("");
            const language = String(code.properties?.className || "").replace(/^language-/, "");
            return <ChatCodeSnippet text={text} language={language} />;
          },
          blockquote: ({ children }) => (
            <blockquote className="chat-quote-card">
              <Quote className="chat-quote-icon" size={17} aria-hidden="true" />
              {children}
            </blockquote>
          ),
          a: ({ href, children, node }) => {
            if (node?.children.some(child => child.type === "element" && child.tagName === "img")) return <span>{children}</span>;
            if (!href) return <span>{children}</span>;
            const codeBranch = chatCodeBranch(href);
            if (codeBranch) {
              if (codeBranch.path) return <span className="chat-code-reference"><Link className="chat-ticket-link chat-code-link" to={codeBranch.href} title={`${codeBranch.branch} · ${codeBranch.path}`}><FileCode2 size={14} aria-hidden="true" /><span>{codeBranch.path}:{codeBranch.startLine}{codeBranch.endLine !== codeBranch.startLine ? `–${codeBranch.endLine}` : ""}</span></Link></span>;
              return <span className="chat-code-reference"><CopyableLink href={codeBranch.href} copyValue={codeBranch.branch}><Link className="chat-ticket-link chat-branch-link" to={codeBranch.href} title={codeBranch.branch}><GitBranch size={14} aria-hidden="true" /><span>{codeBranch.branch}</span></Link></CopyableLink></span>;
            }
            const pr = chatPrCard(href);
            if (pr) {
              const date = new Date(pr.createdAt);
              return <span className="chat-pr-card">
                <GitPullRequest size={18} className="chat-pr-card-icon" aria-hidden="true" />
                <span className="chat-pr-card-body"><strong title={pr.title}>#{pr.number} · {pr.title}</strong>
                  <span className="chat-pr-card-meta"><span title={pr.author}>{pr.author}</span><span>·</span><time dateTime={Number.isNaN(date.getTime()) ? undefined : pr.createdAt}>{Number.isNaN(date.getTime()) ? "Дата не указана" : date.toLocaleDateString("ru-RU")}</time></span>
                  <Link to={pr.href} className="chat-ticket-link">Перейти к pull request<ArrowUpRight size={13} aria-hidden="true" /></Link>
                </span>
              </span>;
            }
            const citation = chatTicketCitation(href);
            const local = chatTicketPath(href) || azureTicketPath(href, azureSource);
            if (local) {
              const params = new URLSearchParams(local.split("?")[1]);
              if (citation) return <button type="button" className="chat-ticket-link" onClick={() => {
                window.dispatchEvent(new CustomEvent("orbit-show-ticket-details", { detail: { source: citation.source, tickets: [{ id: citation.id, title: `#${citation.id}` }], citation } }));
              }}>Показать в тикете<ArrowUpRight size={14} aria-hidden="true" /></button>;
              return <CopyableLink href={href} ticket><a className="chat-ticket-link" href={local} onClick={event => {
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                const id = Number(params.get("id"));
                window.dispatchEvent(new CustomEvent("orbit-show-ticket-details", { detail: { source: params.get("source"), tickets: [{ id, title: `#${id}` }] } }));
              }}>{children}<ArrowUpRight size={14} aria-hidden="true" /></a></CopyableLink>;
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
