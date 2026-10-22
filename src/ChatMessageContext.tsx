import { ImagePreview } from "./ImagePreview.js";
import { Eye, Sparkles, File } from "lucide-react";
import type { ChatMessageContext as ContextBadge } from "../server/chat-message-context.js";

export function ChatMessageContext({ badges, context, sessionId, previews }: {
  badges?: ContextBadge[]; context?: {client:string;project:string}; sessionId?:string;
  previews?:Record<string,string>;
}) {
  if (!badges?.length) return null;
  return (
    <div className="chat-message-context" aria-label="Контекст сообщения">
      {badges.map((badge, index) => {
        const image=badge.kind==="file" && badge.mime?.startsWith("image/");
        const src=previews?.[String(badge.id)] || (context && sessionId ? "/api/conversation/files/"+encodeURIComponent(badge.id)+"?"+new URLSearchParams({...context,sessionId}) : "");
        if(image && src) return <figure className="chat-message-image" key={`${badge.id}:${index}`}>
          <ImagePreview src={src} alt={badge.title || `Вложение ${badge.number}`}/>
          <figcaption title={badge.title}>Вложение {badge.number} · {badge.title || "Изображение"}</figcaption>
        </figure>;
        return (
        <span
          className="chat-message-context-badge"
          key={`${badge.kind}:${badge.id}:${index}`}
          title={badge.title}
        >
          {badge.kind === "file" ? (
            <File size={13} aria-hidden="true" />
          ) : badge.kind === "viewed_ticket" ? (
            <Eye size={13} aria-hidden="true" />
          ) : (
            <Sparkles size={13} aria-hidden="true" />
          )}
          <span>
            {badge.kind === "file"
              ? `Вложение ${badge.number}`
              : badge.kind === "analyze_ticket"
                ? `Analyze with AI · Тикет #${badge.id}`
                : badge.kind === "viewed_ticket"
                  ? `Тикет из деталки #${badge.id}`
                  : `Refine with AI · ${badge.savedMemory ? "Память" : "Предложение"}`}
            {badge.title && (
              <span className="chat-message-context-title">
                {" "}
                · {badge.title}
              </span>
            )}
          </span>
        </span>
      );})}
    </div>
  );
}
