import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => (/^(https?:\/\/|mailto:)/i.test(url) ? url : "")}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) =>
            typeof src === "string" && src ? (
              <a href={src} target="_blank" rel="noopener noreferrer">
                {alt || "Открыть изображение"}
              </a>
            ) : (
              <span>{alt || "Изображение"}</span>
            ),
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
