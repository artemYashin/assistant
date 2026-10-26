import { useLatestCallback } from "../../../shared/lib/latest-callback/index.js";
import { useImageAttachmentQueue } from "../../../features/attach-chat-image/index.js";
import {
  useChatFiles,
  uploadChatFiles,
  ChatFilePicker,
  ChatFileRows,
  ChatFileDropArea,
  ChatFileErrorDialog,
} from "../../../features/chat-attachments/index.js";
import { ChatMessageContext } from "./ChatMessageContext.js";
import { messageContextBadges } from "../../../../../backend/src/chat-message-context.js";
import { ComposerDictation } from "../../../features/voice-input/index.js";
import { currentRepositoryBranch } from "../../../entities/repository/index.js";
import { currentViewedTicket, useViewedTicket } from "../../../entities/ticket/index.js";
import { ModelOverride } from "../../../entities/llm/index.js";
import { Eye } from "lucide-react";
import {
  analyzeTicketEvent,
  analysisChatReadyEvent,
  type AnalyzeTicketRequest,
} from "../../../entities/chat/index.js";
import { ChatHistory } from "../../../features/manage-chat-history/index.js";
import { ChatTools } from "./ChatTools.js";
import { useSelectedChatTickets } from "../../../entities/ticket/index.js";
import {
  openTicketExport,
  editTicketExport,
  currentTicketExport,
} from "../../../features/export-tickets/ui/index.js";
import { useNavigate } from "react-router-dom";
import { useAssistantResize } from "../model/resize.js";
import { ChatMarkdown } from "../../../features/render-content/index.js";
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowUp,
  BookOpen,
  ChevronRight,
  LoaderCircle,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Square,
  Ticket,
  Trash2,
  X,
  PanelRightClose,
} from "lucide-react";
import { VoiceShortcut } from "../../../features/voice-input/index.js";
import {
  ChatStream,
  ChatTimeline,
  ChatToolHistory,
  useChatStream,
  formatChatDuration,
} from "./ChatStream.js";
import type { ChatProgress } from "../../../../../backend/src/chat-stream.js";
import { api } from "../../../shared/api/http/index.js";
import { apiProgress, followChatRun } from "../../../entities/chat/api/index.js";

export function Assistant({
  ticketCard: TicketCard,
  voiceCurrentPress,
  voiceNewPress,
  voiceCurrentKey,
  voiceNewKey,
  azureSource,
  open,
  onExpand,
  onCollapse,
  context,
  connected,
  onChange,
  onSettings,
  onApprovals,
  pending,
}: any) {
  const navigate = useNavigate();
  const [chatUsage, setChatUsage] = useState<{
    inputTokens: number;
    outputTokens: number;
    reports: number;
    partial: boolean;
    contextUsage?: {
      currentTokens: number;
      tokenLimit: number;
      model: string;
      updatedAt: string;
    } | null;
  }>({ inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
  const [shortcutBusy, setShortcutBusy] = useState(false);
  const [voiceStartSession, setVoiceStartSession] = useState("");
  const resize = useAssistantResize();
  const chatStream = useChatStream();
  const resetStream = chatStream.reset;
  const notifyChanged = useLatestCallback(onChange);
  const conversationView = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = conversationView.current;
    if (!element) return;
    // Measure the visible message viewport, never the scrollable content height.
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.height > 0)
        element.style.setProperty("--chat-image-max-height", `${entry.contentRect.height * 0.3}px`);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const followStream = useRef(true);
  const chatConnection = useRef<AbortController | null>(null);
  useEffect(() => {
    const element = conversationView.current;
    if (element && followStream.current) element.scrollTop = element.scrollHeight;
  }, [chatStream.live]);
  useEffect(() => () => chatConnection.current?.abort(), []);
  const selectedTickets = useSelectedChatTickets();
  const viewedTicket = useViewedTicket();
  const [sessionId, setSessionId] = useState("");
  const fileDraft = useChatFiles(JSON.stringify([context.client, context.project, sessionId]));
  const [chatModel, setChatModel] = useState("");
  const [attachment, setAttachment] = useState<any>(null);
  const [memoryProposalAttachment, setMemoryProposalAttachment] = useState<{
    id: string;
    body: string;
    summary?: string;
    target_memory_id?: string;
  } | null>(null);
  useEffect(() => {
    setMemoryProposalAttachment(null);
  }, [context.client, context.project, sessionId]);
  useEffect(() => {
    const handle = (event: Event) => {
      const proposal = (event as CustomEvent).detail;
      if (!proposal?.id || typeof proposal.body !== "string") return;
      if (
        (proposal.scope !== "general" && proposal.client !== context.client) ||
        (["project", "project_review"].includes(proposal.scope) &&
          proposal.project !== context.project)
      )
        return;
      setMemoryProposalAttachment({
        id: proposal.id,
        body: proposal.body,
        summary: proposal.summary,
        target_memory_id: proposal.target_memory_id,
      });
      onExpand();
    };
    window.addEventListener("orbit:refine-memory", handle);
    return () => window.removeEventListener("orbit:refine-memory", handle);
  }, [context.client, context.project, onExpand]);
  const analysisPending = useRef(false);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const clearChatDialog = useRef<HTMLDialogElement>(null);
  const [chatFileError, setChatFileError] = useState("");
  const [imageLoading, setImageLoading] = useState(0);
  const [clearChatError, setClearChatError] = useState("");
  const clearChatLock = useRef(false);
  useEffect(() => {
    clearChatDialog.current?.close();
    setClearChatError("");
  }, [context.client, context.project, sessionId]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("Новый чат");
  const [history, setHistory] = useState<any[]>([]),
    [prompt, setPrompt] = useState(""),
    [working, setWorking] = useState(false),
    [clearing, setClearing] = useState(false),
    [error, setError] = useState(""),
    [recording, setRecording] = useState(false);
  useImageAttachmentQueue({
    context,
    sessionId,
    working,
    clearing,
    onExpand,
    onError: setChatFileError,
    onPending: setImageLoading,
    add: fileDraft.add,
  });
  const bottom = useRef<HTMLDivElement>(null),
    historyGeneration = useRef(0),
    contextKey = useRef("");
  const key = JSON.stringify(context);
  contextKey.current = key;
  const receiveChatProgress = useLatestCallback((event: ChatProgress, replay = false) => {
    if (event.stage === "usage") {
      setChatUsage(event);
      return;
    }
    if (["preparing", "text", "tool"].includes(event.stage)) {
      chatStream.receive(event);
      return;
    }
    // Replaying visual history must not repeat exports, navigation or other UI actions.
    if (replay) return;
    if (event.stage === "data_synced")
      window.dispatchEvent(new CustomEvent("orbit:data-synced", { detail: event }));
    else if (event.stage === "calendar_changed") {
      window.dispatchEvent(new Event("orbit:developer-board"));
      window.dispatchEvent(new Event("orbit-calendar-changed"));
      window.dispatchEvent(new CustomEvent("orbit:data-synced", { detail: { domain: "tickets" } }));
    } else if (event.stage === "ticket_export") {
      if (event.mode === "edit") editTicketExport(event.ids, event.removeIds, event.columns);
      else openTicketExport(event.ids, event.columns);
    } else if (event.stage === "show_tickets")
      window.dispatchEvent(new CustomEvent("orbit-show-ticket-details", { detail: event }));
    else if (event.stage === "close_ticket_details") {
      window.dispatchEvent(new Event("orbit-close-ticket-details"));
      onExpand();
    } else chatStream.receive(event);
  });
  useEffect(() => {
    let active = true;
    const generation = ++historyGeneration.current;
    const restoreConnection = new AbortController();
    setWorking(false);
    setHistory([]);
    setChatUsage({ inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
    resetStream();
    setSessionId("");
    setAttachment(null);
    setHasOlder(false);
    setPrompt("");
    setError("");
    api(
      `/conversation/sessions?${new URLSearchParams({ client: context.client, project: context.project })}`,
    )
      .then(async (result) => {
        const running = await api(
          `/conversation/runs?${new URLSearchParams({ client: context.client, project: context.project, sessionId: result.activeId })}`,
        );
        const page = await api(
          `/conversation?${new URLSearchParams({ client: context.client, project: context.project, sessionId: result.activeId, page: "true" })}`,
        );
        if (active && generation === historyGeneration.current) {
          setSessionId(result.activeId);
          setSessionTitle(
            result.sessions.find((s: any) => s.id === result.activeId)?.title || "Новый чат",
          );
          setHistory(page.messages);
          setAttachment(page.attachment);
          setHasOlder(page.hasMore);
          setChatUsage(
            page.usage || { inputTokens: 0, outputTokens: 0, reports: 0, partial: false },
          );
          if (running.runId) {
            setWorking(true);
            let replayRemaining = running.eventCount;
            try {
              await followChatRun<ChatProgress>(
                running.runId,
                (event) => {
                  if (active && generation === historyGeneration.current)
                    receiveChatProgress(event, replayRemaining-- > 0);
                },
                restoreConnection.signal,
              );
            } catch (error: any) {
              if (active && generation === historyGeneration.current) setError(error.message);
            } finally {
              if (active && generation === historyGeneration.current) {
                try {
                  const finalPage = await api(
                    `/conversation?${new URLSearchParams({ client: context.client, project: context.project, sessionId: result.activeId, page: "true" })}`,
                  );
                  if (active && generation === historyGeneration.current) {
                    setHistory(finalPage.messages);
                    setHasOlder(finalPage.hasMore);
                    setChatUsage(
                      finalPage.usage || {
                        inputTokens: 0,
                        outputTokens: 0,
                        reports: 0,
                        partial: false,
                      },
                    );
                  }
                } finally {
                  if (active && generation === historyGeneration.current) {
                    resetStream();
                    setWorking(false);
                    notifyChanged();
                  }
                }
              }
            }
          }
        }
      })
      .catch((e) => {
        if (active && generation === historyGeneration.current) setError(e.message);
      });
    return () => {
      active = false;
      restoreConnection.abort();
    };
  }, [context.client, context.project, resetStream, receiveChatProgress, notifyChanged]);
  const lastMessageId = history.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lastMessageId, working]);
  useEffect(() => {
    const handle = (event: Event) => {
      const task = (event as CustomEvent<AnalyzeTicketRequest>).detail;
      if (working || clearing || recording || shortcutBusy || analysisPending.current) {
        task.reject(
          new Error(
            "Дождитесь завершения текущего ответа или записи голоса, затем начните анализ.",
          ),
        );
        return;
      }
      analysisPending.current = true;
      const captured = key;
      const generation = ++historyGeneration.current;
      setClearing(true);
      void (async () => {
        try {
          const session = await api("/conversation/sessions", "POST", {
            client: context.client,
            project: context.project,
            ticketCardRef: task.reference,
          });
          const page = await api(
            `/conversation?${new URLSearchParams({ client: context.client, project: context.project, sessionId: session.id, page: "true" })}`,
          );
          if (contextKey.current !== captured || generation !== historyGeneration.current)
            throw new Error(
              "Контекст проекта изменился. Чат сохранён в истории исходного проекта.",
            );
          setSessionId(session.id);
          setSessionTitle(session.title);
          setHistory(page.messages);
          setAttachment(page.attachment);
          setHasOlder(false);
          setChatUsage(
            page.usage || { inputTokens: 0, outputTokens: 0, reports: 0, partial: false },
          );
          setPrompt(
            `Проанализируй тикет #${page.attachment.id}: объясни требования, найди неоднозначности и риски, предложи проверки.`,
          );
          setError("");
          onExpand();
          window.dispatchEvent(new Event(analysisChatReadyEvent));
          requestAnimationFrame(() => promptInput.current?.focus());
          task.resolve();
        } catch (e: any) {
          task.reject(e);
        } finally {
          analysisPending.current = false;
          setClearing(false);
        }
      })();
    };
    window.addEventListener(analyzeTicketEvent, handle);
    return () => window.removeEventListener(analyzeTicketEvent, handle);
  }, [key, context.client, context.project, working, clearing, shortcutBusy, recording, onExpand]);
  async function chooseChat(id?: string, startVoice = false) {
    if (working || clearing || shortcutBusy || recording) return;
    if (!id && startVoice && sessionId && !history.length && !hasOlder && !attachment) {
      setVoiceStartSession(sessionId);
      onExpand();
      return;
    }
    const captured = key;
    const generation = ++historyGeneration.current;
    setClearing(true);
    try {
      const session = id
        ? await api(`/conversation/sessions/${id}/active`, "PUT", context)
        : await api("/conversation/sessions", "POST", context);
      const page = await api(
        `/conversation?${new URLSearchParams({ client: context.client, project: context.project, sessionId: session.id, page: "true" })}`,
      );
      if (contextKey.current === captured && generation === historyGeneration.current) {
        setSessionId(session.id);
        if (startVoice) {
          setVoiceStartSession(session.id);
          onExpand();
        }
        setSessionTitle(session.title);
        setHistory(page.messages);
        setAttachment(page.attachment);
        setHasOlder(page.hasMore);
        setChatUsage(page.usage || { inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
        setPrompt("");
        setError("");
      }
    } finally {
      setClearing(false);
    }
  }
  async function loadOlder() {
    if (loadingOlder || !hasOlder || !history[0]?.sequence) return;
    const generation = historyGeneration.current;
    const container = bottom.current?.parentElement;
    const height = container?.scrollHeight || 0;
    const top = container?.scrollTop || 0;
    setLoadingOlder(true);
    try {
      const page = await api(
        `/conversation?${new URLSearchParams({ ...context, sessionId, page: "true", before: String(history[0].sequence) })}`,
      );
      if (generation === historyGeneration.current) {
        setHistory((h) => [...page.messages, ...h]);
        setHasOlder(page.hasMore);
        setChatUsage(page.usage || { inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
        requestAnimationFrame(() => {
          if (container && generation === historyGeneration.current)
            container.scrollTop = top + container.scrollHeight - height;
        });
      }
    } catch (e: any) {
      if (generation === historyGeneration.current) setError(e.message);
    } finally {
      setLoadingOlder(false);
    }
  }
  async function detachAnalysis() {
    if (working || clearing || recording || !sessionId || !attachment) return;
    const captured = key;
    const generation = historyGeneration.current;
    const defaultPrompt = `Проанализируй тикет #${attachment.id}: объясни требования, найди неоднозначности и риски, предложи проверки.`;
    setClearing(true);
    setError("");
    try {
      await api(`/conversation/sessions/${sessionId}/attachment`, "DELETE", context);
      if (contextKey.current === captured && generation === historyGeneration.current) {
        setAttachment(null);
        setPrompt((current) => (current === defaultPrompt ? "" : current));
      }
    } catch (e: any) {
      if (contextKey.current === captured && generation === historyGeneration.current)
        setError(e.message);
    } finally {
      setClearing(false);
    }
  }
  async function clearHistory() {
    if (working || clearing || shortcutBusy || recording) return;
    if (clearChatLock.current || !sessionId) return;
    clearChatLock.current = true;
    setClearChatError("");
    const captured = key;
    const generation = historyGeneration.current;
    setClearing(true);
    setError("");
    try {
      await api("/conversation", "DELETE", { ...context, sessionId });
      fileDraft.release(fileDraft.take());
      if (contextKey.current === captured && generation === historyGeneration.current) {
        historyGeneration.current++;
        setHistory([]);
        setHasOlder(false);
        setSessionTitle("Новый чат");
        setChatUsage({ inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
        chatStream.reset();
        setAttachment(null);
        clearChatDialog.current?.close();
      }
    } catch (e: any) {
      if (contextKey.current === captured && generation === historyGeneration.current)
        setClearChatError(e.message);
    } finally {
      clearChatLock.current = false;
      setClearing(false);
    }
  }
  async function send(e?: React.FormEvent, voiceText?: string) {
    e?.preventDefault();
    if (imageLoading) {
      if (voiceText) setPrompt(voiceText);
      setError("Дождитесь загрузки изображения, затем отправьте сообщение.");
      return;
    }
    const text =
      (voiceText ?? prompt).trim() ||
      (fileDraft.files.length ? "Прочитай все приложенные файлы." : "");
    const sentAnalysis = attachment;
    const sentMemoryProposal = memoryProposalAttachment;
    const sentViewedTicket = currentViewedTicket();
    const sentContext = messageContextBadges({
      analysis: sentAnalysis,
      proposal: sentMemoryProposal,
      viewed: sentViewedTicket,
      files: fileDraft.files.map((file) => ({
        id: file.localId,
        name: file.file.name,
        mime: file.mime,
      })),
    });
    if (!text.trim() || working || clearing || !sessionId || (!voiceText && shortcutBusy)) return;
    const captured = key;
    const generation = historyGeneration.current;
    const sentFiles = fileDraft.take();
    setWorking(true);
    setAttachment(null);
    setMemoryProposalAttachment(null);
    chatStream.reset();
    followStream.current = true;
    chatConnection.current = new AbortController();
    setError("");
    if (!voiceText) setPrompt("");
    if (!history.length) setSessionTitle(text.replace(/\s+/g, " ").trim().slice(0, 80));
    const sentMessageId = Date.now();
    setHistory((h) => [
      ...h,
      {
        role: "user",
        body: text,
        id: sentMessageId,
        message_context: sentContext,
        image_previews: Object.fromEntries(
          sentFiles.filter((file) => file.preview).map((file) => [file.localId, file.preview]),
        ),
      },
    ]);
    try {
      const fileIds = await uploadChatFiles(
        sentFiles,
        context,
        sessionId,
        chatConnection.current!.signal,
      );
      if (contextKey.current === captured && generation === historyGeneration.current) {
        const uploadedContext = messageContextBadges({
          analysis: sentAnalysis,
          proposal: sentMemoryProposal,
          viewed: sentViewedTicket,
          files: sentFiles.map((file, index) => ({
            id: fileIds[index],
            name: file.file.name,
            mime: file.mime,
          })),
        });
        setHistory((h) =>
          h.map((message) =>
            message.id === sentMessageId
              ? { ...message, message_context: uploadedContext, image_previews: undefined }
              : message,
          ),
        );
      }
      const r = await apiProgress<ChatProgress>(
        "/conversation",
        {
          fileIds,
          prompt: text,
          model: chatModel,
          context,
          sessionId,
          viewedTicket: sentViewedTicket,
          ticketExport: currentTicketExport(),
          repositoryBranch: currentRepositoryBranch(context),
          memoryProposalId: sentMemoryProposal?.id,
          selectedTickets: selectedTickets.map(({ id, source }) => ({
            id,
            source,
          })),
        },
        (event) => {
          if (contextKey.current === captured && generation === historyGeneration.current) {
            receiveChatProgress(event);
          }
        },
        chatConnection.current!.signal,
      );
      fileDraft.release(sentFiles);
      const toolSnapshot = chatStream.tools();
      if (contextKey.current === captured && generation === historyGeneration.current)
        setHistory((h) => [
          ...h,
          {
            role: "assistant",
            body: r.body,
            id: Date.now(),
            cards: r.cards || [],
            duration_ms: r.durationMs ?? chatStream.elapsed(),
            tools: toolSnapshot,
            timeline: r.timeline,
          },
        ]);
      if (contextKey.current === captured && generation === historyGeneration.current)
        chatStream.reset();
      onChange();
    } catch (e: any) {
      fileDraft.restore(sentFiles);
      if (contextKey.current === captured && generation === historyGeneration.current) {
        if (sentAnalysis) setAttachment((current: any) => current ?? sentAnalysis);
        if (sentMemoryProposal)
          setMemoryProposalAttachment((current) => current ?? sentMemoryProposal);
        const partial = chatStream.partial();
        const toolSnapshot = chatStream.tools().map((tool) => ({
          ...tool,
          status: tool.status === "running" ? "interrupted" : tool.status,
        }));
        if (partial)
          setHistory((h) => [
            ...h,
            {
              role: "assistant",
              body: partial + "\n\n_Ответ прерван._",
              id: Date.now(),
              duration_ms: chatStream.elapsed(),
              tools: toolSnapshot,
              timeline: chatStream.timeline(),
            },
          ]);
        setError(e.message);
        setPrompt((current) => (voiceText ? [current, text].filter(Boolean).join("\n") : text));
      }
      if (contextKey.current === captured && generation === historyGeneration.current)
        chatStream.reset();
      onChange();
    } finally {
      try {
        const page = await api(
          `/conversation?${new URLSearchParams({ ...context, sessionId, page: "true" })}`,
        );
        if (contextKey.current === captured && generation === historyGeneration.current) {
          setHistory((existing) => [
            ...existing.filter(
              (message) => message.sequence && message.sequence < (page.messages[0]?.sequence || 0),
            ),
            ...page.messages,
          ]);
          setChatUsage(
            page.usage || { inputTokens: 0, outputTokens: 0, reports: 0, partial: false },
          );
          setHasOlder(page.hasMore);
        }
      } catch {
        /* Keep the received response if history refresh fails. */
      }
      if (contextKey.current === captured && generation === historyGeneration.current)
        chatStream.reset();
      if (contextKey.current === captured && generation === historyGeneration.current)
        setWorking(false);
    }
  }
  return (
    <aside
      id="assistant-panel"
      className="assistant-panel"
      hidden={!open}
      style={{ "--chat-width": `${resize.width}px` } as React.CSSProperties}
    >
      <VoiceShortcut
        unavailableReason={
          working
            ? "Ассистент сейчас отвечает в чате. Дождитесь ответа или остановите его, затем снова нажмите голосовую горячую клавишу."
            : clearing
              ? "История чата сейчас очищается. Дождитесь завершения и попробуйте ещё раз."
              : !connected
                ? "Сначала подключите Copilot в настройках."
                : !sessionId
                  ? "Чат ещё загружается. Дождитесь загрузки и попробуйте ещё раз."
                  : recording
                    ? "Уже идёт голосовая диктовка. Сначала завершите её."
                    : undefined
        }
        currentPress={voiceCurrentPress}
        newPress={voiceNewPress}
        currentKey={voiceCurrentKey}
        newKey={voiceNewKey}
        onOpen={onExpand}
        key={key + ":" + sessionId}
        enabled={!!connected && !!sessionId && !working && !clearing && !recording}
        autoStart={voiceStartSession === sessionId}
        onAutoStarted={() => setVoiceStartSession("")}
        onNewChat={() => {
          void chooseChat(undefined, true).catch((e) => setError(e.message));
        }}
        title={sessionTitle}
        onBusy={setShortcutBusy}
        onText={(text) => {
          onExpand();
          void send(undefined, text);
        }}
      />
      {resize.handle}
      <div className="assistant-heading">
        <div className="assistant-symbol">
          <Sparkles size={20} />
        </div>
        <div className="assistant-heading-text">
          <b title={[context.client, context.project].filter(Boolean).join(" / ")}>
            {[context.client, context.project].filter(Boolean).join(" / ") || "Общий контекст"}
          </b>
          <small className="assistant-chat-title" title={sessionTitle}>
            <span
              className={`dot ${connected ? "" : "offline"}`}
              title={connected ? "Copilot подключён" : "Нет подключения"}
            />
            {sessionTitle}
          </small>
        </div>
        <ChatTools context={context} sessionId={sessionId} />
        <ChatHistory
          context={context}
          activeId={sessionId}
          disabled={working || clearing || shortcutBusy || recording || !sessionId}
          onSelect={chooseChat}
        />
        <button
          type="button"
          className="icon-button"
          aria-label="Свернуть панель чата"
          title="Свернуть чат"
          onClick={onCollapse}
        >
          <PanelRightClose size={18} />
        </button>
      </div>
      <div
        className="assistant-token-usage"
        title={`Токены текущего чата по отчётам SDK. ${chatUsage.partial ? "Для старых сообщений до обновления расход не привязан к чату." : "Включая контекст и инструменты."}`}
      >
        <span>Токены{chatUsage.partial ? " (частично)" : ""}</span>
        <span>
          Вход{" "}
          <b>{!clearing && chatUsage.reports ? chatUsage.inputTokens.toLocaleString() : "—"}</b>
        </span>
        <span>
          Выход{" "}
          <b>{!clearing && chatUsage.reports ? chatUsage.outputTokens.toLocaleString() : "—"}</b>
        </span>
        {!clearing && chatUsage.contextUsage ? (
          <span
            className="assistant-context-usage"
            title={`Последний отчёт SDK · ${chatUsage.contextUsage.model} · ${new Date(chatUsage.contextUsage.updatedAt).toLocaleString()}. Заполненность контекста, включая сообщения, инструкции и инструменты; не лимит подписки. После смены модели обновится по новому отчёту.`}
          >
            <span>
              Контекст{" "}
              <b>
                {chatUsage.contextUsage.currentTokens.toLocaleString()} /{" "}
                {chatUsage.contextUsage.tokenLimit.toLocaleString()}
              </b>
            </span>
            <span>
              Осталось{" "}
              <b>
                {Math.max(
                  0,
                  chatUsage.contextUsage.tokenLimit - chatUsage.contextUsage.currentTokens,
                ).toLocaleString()}
              </b>
            </span>
            <span>
              <b>
                {Math.round(
                  (chatUsage.contextUsage.currentTokens / chatUsage.contextUsage.tokenLimit) * 100,
                )}
                %
              </b>
            </span>
            <progress
              aria-label="Заполненность контекста"
              max={chatUsage.contextUsage.tokenLimit}
              value={chatUsage.contextUsage.currentTokens}
            />
          </span>
        ) : (
          <span className="assistant-context-usage">Контекст — ожидаем отчёт SDK</span>
        )}
      </div>
      <div
        className="conversation"
        aria-busy={clearing}
        ref={conversationView}
        onScroll={(event) => {
          const element = event.currentTarget;
          followStream.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        {hasOlder && (
          <button
            type="button"
            className="text-button chat-load-older"
            disabled={loadingOlder || clearing}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? "Загрузка…" : "Показать более ранние сообщения"}
          </button>
        )}
        {!history.length && (
          <div className="assistant-welcome">
            <div className="welcome-symbol">
              <Sparkles size={27} />
            </div>
            <h2>
              Давайте освободим
              <br />
              немного внимания.
            </h2>
            <p>Я помогу собрать контекст, запомнить важное и подготовить ответ.</p>
            <div className="prompt-suggestions">
              {[
                "Какие тикеты требуют моего внимания?",
                "Покажи, что ты помнишь о текущем проекте",
                "Помоги с приложением",
              ].map((p, i) => (
                <button key={p} onClick={() => setPrompt(p)}>
                  {i === 0 ? (
                    <Ticket size={16} />
                  ) : i === 1 ? (
                    <BookOpen size={16} />
                  ) : (
                    <MessageSquare size={16} />
                  )}
                  <span>{p}</span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
            {!connected && (
              <button className="connect-link" onClick={onSettings}>
                Подключить GitHub Copilot <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        )}
        {history.map((m: any, i: number) => (
          <div className={`bubble ${m.role}`} key={m.id || i}>
            {m.role === "assistant" && (
              <span className="bubble-author">
                <Sparkles size={13} /> Orbit
              </span>
            )}
            {m.role === "user" && (
              <ChatMessageContext
                badges={m.message_context}
                context={context}
                sessionId={sessionId}
                previews={m.image_previews}
              />
            )}
            {!m.timeline?.length && <ChatToolHistory tools={m.tools} />}
            {m.role === "error" ? (
              <>
                {m.timeline?.length > 0 && (
                  <ChatTimeline items={m.timeline} azureSource={azureSource} />
                )}
                <p>{m.body}</p>
              </>
            ) : m.timeline?.length ? (
              <ChatTimeline items={m.timeline} azureSource={azureSource} />
            ) : (
              <ChatMarkdown text={m.body} azureSource={azureSource} />
            )}
            {typeof m.duration_ms === "number" && (
              <div className="chat-elapsed">
                Время работы: <time>{formatChatDuration(m.duration_ms)}</time>
              </div>
            )}
            {(typeof m.cards === "string" ? JSON.parse(m.cards) : m.cards || []).map(
              (ref: string) => (
                <TicketCard key={ref} reference={ref} />
              ),
            )}
          </div>
        ))}
        {working && <ChatStream live={chatStream.live} azureSource={azureSource} />}
        {working && (
          <div className="thinking">
            <LoaderCircle size={14} className="spin" />
            {chatStream.live.text
              ? "Формирую ответ…"
              : chatStream.live.tools.some((tool) => tool.status === "running")
                ? "Выполняю инструменты…"
                : "Собираю контекст и готовлю ответ…"}
          </div>
        )}
        <div ref={bottom} />
      </div>
      {pending > 0 && (
        <button className="pending-bar" onClick={onApprovals}>
          <ShieldCheck size={16} />
          {pending} предлож. ждут подтверждения
          <ChevronRight size={15} />
        </button>
      )}
      <div className="composer-wrap">
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="text-button" onClick={() => setError("")}>
              Закрыть
            </button>
          </div>
        )}
        {attachment && (
          <div className="chat-analysis-attachment">
            <div className="chat-analysis-heading">
              <span className="chat-analysis-badge">
                <Sparkles size={14} /> Анализ тикета #{attachment.id}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Не прикреплять тикет к сообщению"
                title="Убрать прикреплённый тикет. Переписка сохранится."
                disabled={working || clearing || shortcutBusy || recording || !sessionId}
                onClick={() => void detachAnalysis()}
              >
                <X size={16} />
              </button>
            </div>
            <strong>{attachment.title}</strong>
            <small>
              Описание, критерии, шаги воспроизведения и комментарии ({attachment.comments}). Снимок
              от {new Date(attachment.loadedAt).toLocaleString("ru-RU")}.
            </small>
            <small>
              Полный текст · {attachment.characters.toLocaleString("ru-RU")} символов. Отправка
              может потребовать много токенов. Дополните запрос и нажмите «Отправить».
            </small>
            {!!attachment.warnings?.length && (
              <small className="error">{attachment.warnings.join(" ")}</small>
            )}
          </div>
        )}
        {!!selectedTickets.length && (
          <div className="chat-ticket-context">
            <small>
              Номера тикетов в контексте следующего сообщения · {selectedTickets.length}
            </small>
            <div className="chat-ticket-badges">
              {selectedTickets.map((ticket) => (
                <span className="badge" key={`${ticket.source}:${ticket.id}`} title={ticket.title}>
                  #{ticket.id}
                </span>
              ))}
            </div>
          </div>
        )}
        {viewedTicket && (
          <div className="chat-viewed-ticket" aria-live="polite">
            <span title="Номер открытого тикета будет передан ассистенту с вашим сообщением. Полное описание автоматически не передаётся.">
              <Eye size={13} aria-hidden="true" /> Открыт тикет <b>#{viewedTicket.id}</b>
            </span>
          </div>
        )}
        {memoryProposalAttachment && (
          <div className="chat-memory-attachment">
            <Sparkles size={15} aria-hidden="true" />
            <div>
              <strong>
                {memoryProposalAttachment.target_memory_id
                  ? "Редактирование сохранённой памяти"
                  : "Редактирование предложения в память"}
              </strong>
              <span title={memoryProposalAttachment.body}>{memoryProposalAttachment.body}</span>
              <small>Прикреплено к следующему сообщению · можно ответить голосом</small>
            </div>
            <button
              type="button"
              className="icon-button"
              title="Убрать прикреплённое предложение"
              aria-label="Убрать прикреплённое предложение"
              onClick={() => setMemoryProposalAttachment(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <ChatFileDropArea
          disabled={working || clearing || !sessionId}
          onFiles={fileDraft.add}
          onError={setChatFileError}
        >
          <form className="composer" onSubmit={send}>
            <textarea
              ref={promptInput}
              aria-label="Сообщение ассистенту"
              placeholder={recording ? "Голосовой ввод…" : "Спросите или попросите запомнить…"}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={16000}
              rows={3}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (connected && !recording) send(e);
                }
              }}
            />
            {prompt.length > 0 && (
              <button
                type="button"
                className="composer-clear-draft"
                title="Очистить текст сообщения"
                aria-label="Очистить текст сообщения"
                onClick={() => {
                  setPrompt("");
                  promptInput.current?.focus();
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
            {imageLoading > 0 && (
              <small className="chat-image-loading" role="status">
                {working || clearing || !sessionId
                  ? "Изображения в очереди — ожидаю готовности чата…"
                  : "Прикрепляю изображения…"}
              </small>
            )}
            <ChatFileRows files={fileDraft.files} onRemove={fileDraft.remove} />
            <div className="composer-bottom">
              <ChatFilePicker
                disabled={working || clearing || !sessionId}
                onFiles={fileDraft.add}
                onError={setChatFileError}
              />
              <button
                type="button"
                className="secondary composer-clear-history"
                aria-label="Очистить историю чата"
                title="Очистить историю текущего чата"
                disabled={working || clearing || recording || !history.length}
                onClick={() => {
                  setClearChatError("");
                  clearChatDialog.current?.showModal();
                }}
              >
                <Trash2 size={15} />
                <span>Очистить чат</span>
              </button>

              <div className="composer-model">
                <ModelOverride
                  value={chatModel}
                  onChange={setChatModel}
                  disabled={working || clearing || !connected || shortcutBusy}
                />
              </div>
              {working ? (
                <button
                  type="button"
                  className="chat-stop-button"
                  title="Остановить ответ"
                  onClick={() =>
                    api("/conversation/stop", "POST", {}).catch((e) => setError(e.message))
                  }
                >
                  <Square size={15} />
                  <span>Стоп</span>
                </button>
              ) : (
                <>
                  <ComposerDictation
                    key={key + ":" + sessionId}
                    target={promptInput}
                    enabled={!working && !clearing && !shortcutBusy && !!sessionId}
                    onBusy={setRecording}
                  />

                  <button
                    className="send-button"
                    disabled={
                      (!prompt.trim() && !fileDraft.files.length) ||
                      imageLoading > 0 ||
                      working ||
                      recording ||
                      !connected ||
                      clearing ||
                      !sessionId
                    }
                    aria-label="Отправить ассистенту"
                  >
                    <ArrowUp size={19} />
                  </button>
                </>
              )}
            </div>
          </form>
        </ChatFileDropArea>
      </div>
      <ChatFileErrorDialog message={chatFileError} onClose={() => setChatFileError("")} />
      <dialog
        ref={clearChatDialog}
        className="developer-dialog clear-chat-dialog"
        aria-labelledby="clear-chat-title"
        onCancel={(event) => {
          if (clearing) event.preventDefault();
        }}
      >
        <div className="section-heading">
          <h2 id="clear-chat-title">
            <Trash2 size={20} />
            Очистить чат?
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть"
            disabled={clearing}
            onClick={() => clearChatDialog.current?.close()}
          >
            <X size={17} />
          </button>
        </div>
        <p className="clear-chat-name" title={sessionTitle}>
          {sessionTitle}
        </p>
        <p>Все сообщения этого чата будут удалены. Восстановить историю не получится.</p>
        <p className="muted">Другие чаты, память и тикеты сохранятся.</p>
        {clearChatError && (
          <p className="error" role="alert">
            {clearChatError}
          </p>
        )}
        <div className="clear-chat-actions">
          <button
            type="button"
            className="secondary"
            autoFocus
            disabled={clearing}
            onClick={() => clearChatDialog.current?.close()}
          >
            Отмена
          </button>
          <button
            type="button"
            className="clear-chat-confirm"
            disabled={clearing || working || recording || shortcutBusy}
            onClick={() => void clearHistory()}
          >
            <Trash2 size={15} />
            {clearing ? "Очищаю…" : "Очистить чат"}
          </button>
        </div>
      </dialog>
    </aside>
  );
}
