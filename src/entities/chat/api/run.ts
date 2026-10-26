import { api, apiProgress as requestProgress } from "../../../shared/api/http/index.js";

// A cursor makes reconnects idempotent: tools execute only in the server run.
export async function followChatRun<T>(runId: string, onProgress: (value: T) => void, signal: AbortSignal) {
  let cursor = 0;
  while (!signal.aborted) {
    let page;
    try { page = await api(`/conversation/runs/${encodeURIComponent(runId)}?after=${cursor}`, "GET", undefined, signal); }
    catch (error) {
      if (signal.aborted || !(error instanceof TypeError)) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    for (const event of page.events) onProgress(event);
    cursor = page.cursor;
    if (page.done) {
      if (page.error) throw new Error(page.error);
      return page.data;
    }
    if (page.events.length < 250) await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new DOMException("Соединение закрыто", "AbortError");
}

export async function apiProgress<T = { stage: string; percent?: number; startedAt?: number; updatedAt?: number; receivedBytes?: number; bytesPerSecond?: number; receivedObjects?: number; totalObjects?: number; queuePosition?: number; queueLength?: number }>(path: string, body: unknown, onProgress: (value: T) => void, signal: AbortSignal) {
  if (path === "/conversation") {
    const { runId } = await api("/conversation/runs", "POST", body, signal);
    return followChatRun<T>(runId, onProgress, signal);
  }
  return requestProgress<T>(path, body, onProgress, signal);
}
