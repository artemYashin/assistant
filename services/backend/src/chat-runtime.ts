import { assertLlmBinding } from "./llm-provider.js";
import type { CopilotClient, SessionConfig } from "@github/copilot-sdk";
import { AppError, type Store } from "./store.js";

export type ChatRuntimeState = {
  sessionId: string;
  source: string;
  connectionId?: string;
  lastSequence: number;
  memoryHash?: string;
  attachmentHash?: string;
};
export const chatRuntimeKey = (id: string) => `chat.runtime:${id}`;

export async function openChatRuntime(
  client: CopilotClient,
  config: SessionConfig,
  store: Store,
  chatId: string,
  source: string,
  connectionId = "copilot",
  { allowConnectionChange = false }: { allowConnectionChange?: boolean } = {},
) {
  const saved = store.get<ChatRuntimeState | null>(chatRuntimeKey(chatId), null);
  if (saved && !allowConnectionChange) assertLlmBinding(saved.connectionId, connectionId);
  // Native transcript persistence is distinct from cross-session search, which stays disabled.
  const options = { ...config, enableSessionStore: false, infiniteSessions: { enabled: false } };
  if (saved?.source === source) {
    try {
      const session = await client.resumeSession(saved.sessionId, {
        ...options,
        // An omitted model on resume keeps the previous model, which may belong to the external API.
        ...(connectionId === "copilot" &&
        (saved.connectionId || "copilot") !== connectionId &&
        !config.model
          ? { model: "auto" }
          : {}),
        continuePendingWork: false,
      });
      const state = { ...saved, connectionId };
      store.set(chatRuntimeKey(chatId), state);
      return { session, resumed: true, state };
    } catch (error) {
      // Do not turn authentication, connection or corrupt-transcript failures into silent context loss.
      if (
        /session[^\n]*(?:not found|does not exist)|(?:unknown|missing) session/i.test(String(error))
      )
        throw new AppError(
          409,
          "Не найдена сохранённая сессия ассистента. Создайте новый чат или очистите текущий: продолжение без старых результатов инструментов отключено.",
        );
      throw error;
    }
  }
  const session = await client.createSession({ ...options, name: `Orbit ${chatId}` });
  const state: ChatRuntimeState = {
    sessionId: session.sessionId,
    source,
    connectionId,
    lastSequence: 0,
  };
  if (state.sessionId) store.set(chatRuntimeKey(chatId), state);
  return { session, resumed: false, state };
}
