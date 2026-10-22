import { Eye, Sparkles } from "lucide-react";
import type { ChatMessageContext as ContextBadge } from "../server/chat-message-context.js";

export function ChatMessageContext({ badges }: { badges?: ContextBadge[] }) {
  if (!badges?.length) return null;
  return <div className="chat-message-context" aria-label="Контекст сообщения">
    {badges.map((badge, index) => <span className="chat-message-context-badge" key={`${badge.kind}:${badge.id}:${index}`} title={badge.title}>
      {badge.kind === "viewed_ticket" ? <Eye size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
      <span>{badge.kind === "analyze_ticket" ? `Analyze with AI · Тикет #${badge.id}` : badge.kind === "viewed_ticket" ? `Тикет из деталки #${badge.id}` : `Refine with AI · ${badge.savedMemory ? "Память" : "Предложение"}`}
        {badge.title && <span className="chat-message-context-title"> · {badge.title}</span>}
      </span>
    </span>)}
  </div>;
}
