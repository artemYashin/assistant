import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

function PreviewImage({ src, alt }: { src: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="pr-image-error" role="status">
      {alt || "Изображение"}: не удалось загрузить. Проверьте доступ к вложению
      и формат (PNG, JPEG, GIF, WebP).
    </span>
  ) : (
    <a
      className="pr-image-link"
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      title="Открыть изображение в полном размере"
    >
      <img
        src={src}
        alt={alt || "Вложение PR"}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </a>
  );
}
export function ChatMarkdown({
  text,
  images,
}: {
  text: string;
  images?: { source: string; preview: string | null }[];
}) {
  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, key) =>
          key === "src" &&
          images?.some((image) => image.source === url && image.preview)
            ? url
            : /^(https?:\/\/|mailto:)/i.test(url)
              ? url
              : ""
        }
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) => {
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
              return <PreviewImage key={preview} src={preview} alt={alt} />;
            return typeof src === "string" && /^https?:\/\//i.test(src) ? (
              <a href={src} target="_blank" rel="noopener noreferrer">
                {alt || "Открыть изображение"}
              </a>
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
