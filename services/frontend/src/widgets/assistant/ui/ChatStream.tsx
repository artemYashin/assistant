import { useCallback } from "react";
import {
  updateChatTimeline,
  type ChatTimelineItem,
} from "../../../../../backend/src/chat-stream.js";
import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, AlertCircle, Sparkles } from "lucide-react";
import type { ChatProgress } from "../../../../../backend/src/chat-stream.js";
import { ChatMarkdown } from "../../../features/render-content/index.js";

const labels: Record<string, string> = {
  read_memory: "Чтение подробностей памяти",
  read_memory_proposal: "Чтение предложения в память",
  edit_memory_proposal: "Редактирование предложения в память",
  close_ticket_details: "Закрытие деталки и открытие чата",
  show_ticket_details: "Открытие деталок тикетов",
  load_tools: "Подключение инструментов",
  list_tickets: "Поиск локальных тикетов",
  get_ticket: "Чтение тикета",
  list_local_tags: "Чтение локальных тегов",
  get_local_ticket_metadata: "Чтение локальных полей",
  get_ticket_states: "Проверка доступных статусов",
  change_ticket_status: "Изменение статуса",
  batch_update_tickets: "Пакетное изменение тикетов",
  update_local_ticket_metadata: "Изменение локальных полей",
  list_local_developers: "Чтение разработчиков",
  set_local_ticket_developers: "Изменение локального поручения",
  lookup_azure_tickets: "Поиск в Azure",
  request_azure_ticket_lookup: "Подготовка поиска в Azure",
  add_local_ticket: "Импорт тикета",
  remove_local_ticket: "Перемещение тикета в корзину",
  get_workspace_context: "Чтение настроек проекта",
  list_pull_requests: "Поиск pull request",
  get_pull_request: "Чтение pull request",
  request_pull_request_review: "Запуск review",
  list_memories: "Чтение памяти",
  save_memory: "Сохранение памяти",
  propose_memory: "Подготовка предложения в память",
};
type ToolProgress = Extract<ChatProgress, { stage: "tool" }>;
type Live = {
  startedAt: number;
  messageId: string;
  text: string;
  tools: ToolProgress[];
  timeline: ChatTimelineItem[];
};
const empty = (): Live => ({
  startedAt: Date.now(),
  messageId: "",
  text: "",
  tools: [],
  timeline: [],
});
export function useChatStream() {
  const [live, setLive] = useState<Live>(empty);
  const value = useRef<Live>(empty()),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const reset = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    value.current = empty();
    setLive(value.current);
  }, []);
  const receive = useCallback((event: ChatProgress) => {
    value.current = {
      ...value.current,
      timeline: updateChatTimeline(value.current.timeline, event),
    };
    if (event.stage === "preparing" && event.startedAt) {
      value.current = { ...value.current, startedAt: event.startedAt };
    } else if (event.stage === "text") {
      value.current = {
        ...value.current,
        messageId: event.messageId,
        text:
          event.replace || event.messageId !== value.current.messageId
            ? event.text
            : value.current.text + event.text,
      };
    } else if (event.stage === "tool") {
      const previous = value.current.tools.find((tool) => tool.toolId === event.toolId);
      const tools = value.current.tools.filter((tool) => tool.toolId !== event.toolId);
      value.current = {
        ...value.current,
        tools: [
          ...tools,
          { ...event, startedAt: previous?.startedAt || event.startedAt || Date.now() },
        ].slice(-50),
      };
    }
    if (!timer.current)
      timer.current = setTimeout(() => {
        timer.current = undefined;
        setLive(value.current);
      }, 50);
  }, []);
  return {
    live,
    reset,
    receive,
    tools: () => value.current.tools,
    timeline: () => value.current.timeline,
    partial: () => value.current.text,
    elapsed: () => Date.now() - value.current.startedAt,
  };
}
export function formatChatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}
export type ToolTrace = {
  toolId: string;
  name: string;
  names?: string[];
  status: string;
  startedAt?: number;
  offsetMs?: number;
  durationMs?: number;
};
function ToolRows({ tools, now }: { tools: ToolTrace[]; now?: number }) {
  return (
    <div className="chat-tool-rows">
      {tools.map((tool) => (
        <div key={tool.toolId} className={`chat-tool-state-${tool.status}`}>
          {tool.status === "running" ? (
            <LoaderCircle size={13} className="spin" />
          ) : tool.status === "error" || tool.status === "interrupted" ? (
            <AlertCircle size={13} />
          ) : (
            <Check size={13} />
          )}
          <span>
            <span>
              {labels[tool.name] || tool.name} ·{" "}
              {tool.status === "running"
                ? "выполняется"
                : tool.status === "error"
                  ? "ошибка"
                  : tool.status === "interrupted"
                    ? "прерван"
                    : "готово"}
            </span>
            {!!tool.names?.length && (
              <small className="chat-loaded-tools">
                {tool.names.map((name) => labels[name] || name).join(", ")}
              </small>
            )}
            {tool.offsetMs !== undefined && (
              <small className="chat-tool-offset">
                Начало +{formatChatDuration(tool.offsetMs)}
                {tool.startedAt ? ` · ${new Date(tool.startedAt).toLocaleTimeString()}` : ""}
              </small>
            )}
          </span>
          <time title="Время выполнения">
            {tool.durationMs !== undefined
              ? formatChatDuration(tool.durationMs)
              : now && tool.startedAt
                ? formatChatDuration(now - tool.startedAt)
                : "—"}
          </time>
        </div>
      ))}
    </div>
  );
}
export function ChatToolHistory({ tools }: { tools?: ToolTrace[] }) {
  if (!tools?.length) return null;
  return (
    <div className="chat-live-tools">
      <details className="chat-finished-tools">
        <summary>Инструменты · {tools.length} вызовов</summary>
        <ToolRows tools={tools} />
      </details>
    </div>
  );
}
export function ChatStream({ live, azureSource }: { live: Live; azureSource?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="bubble assistant chat-streaming">
      <span className="bubble-author">
        <Sparkles size={13} /> Orbit
      </span>
      <ChatTimeline items={live.timeline} azureSource={azureSource} now={now} />
      <div className="chat-elapsed">
        Время работы: <time>{formatChatDuration(now - live.startedAt)}</time>
      </div>
    </div>
  );
}
export function ChatTimeline({
  items,
  azureSource,
  now,
}: {
  items: ChatTimelineItem[];
  azureSource?: string;
  now?: number;
}) {
  return (
    <div className="chat-timeline">
      {items.map((item) =>
        item.kind === "text" ? (
          item.text && (
            <div className="chat-timeline-message" key={`text:${item.id}`}>
              <ChatMarkdown text={item.text} azureSource={azureSource} />
            </div>
          )
        ) : (
          <div className="chat-live-tools chat-timeline-tool" key={`tool:${item.id}`}>
            <ToolRows
              tools={[
                {
                  ...item.tool,
                  status: !now && item.tool.status === "running" ? "interrupted" : item.tool.status,
                },
              ]}
              now={now}
            />
          </div>
        ),
      )}
    </div>
  );
}
