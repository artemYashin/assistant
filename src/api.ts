let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    credentials: "same-origin",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      "X-Orbit-Request": "1",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body === undefined
      ? {}
      : { body: isForm ? body : JSON.stringify(body) }),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Сервер вернул некорректный ответ" }));
  if (!response.ok)
    throw new Error(
      data.error + (data.fields ? `: ${data.fields.join("; ")}` : ""),
    );
  return data;
}

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

// One POST carries both progress events and the final result; no polling or retry.
export async function apiProgress<T = { stage: string; percent?: number; startedAt?: number; updatedAt?: number; receivedBytes?: number; bytesPerSecond?: number; receivedObjects?: number; totalObjects?: number; queuePosition?: number; queueLength?: number }>(path: string, body: unknown, onProgress: (value: T) => void, signal: AbortSignal) {
  if (path === "/conversation") {
    const { runId } = await api("/conversation/runs", "POST", body, signal);
    return followChatRun<T>(runId, onProgress, signal);
  }
  const response = await fetch(`/api${path}`, {
    method: "POST", credentials: "same-origin", signal,
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", "X-Orbit-Request": "1", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Ошибка запроса");
    return data;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Пустой ответ сервера");
  const decoder = new TextDecoder();
  let buffer = "", received = 0, result: any, finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > 20 * 1024 * 1024) throw new Error("Ответ сервера слишком большой");
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (finished) throw new Error("Некорректное завершение ответа");
        if (event.type === "progress") onProgress(event.progress);
        else if (event.type === "error") throw new Error(event.error || "Операция не выполнена");
        else if (event.type === "result") { result = event.data; finished = true; }
      }
    }
    if (!finished || buffer.trim()) throw new Error("Соединение прервано. Проверьте состояние операции повторно.");
    return result;
  } finally { await reader.cancel().catch(() => {}); }
}
