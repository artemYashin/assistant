import { useEffect, useRef, useState } from "react";
import { Activity, RefreshCw, X } from "lucide-react";
import { formatChatDuration } from "./ChatStream.js";
import { api } from "./api.js";

const statuses: Record<string, string> = {
  running: "Выполняется",
  completed: "Завершён",
  error: "Ошибка",
  limited: "Лимит",
  stopped: "Остановлен",
  interrupted: "Прерван",
};
export function ChatTools({
  context,
}: {
  context: { client: string; project: string };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = JSON.stringify(context);
  useEffect(() => {
    generation.current++;
    dialog.current?.close();
    setOpen(false);
    setRequests([]);
    setError("");
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [key]);
  async function load() {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/conversation/tools?${new URLSearchParams(context)}`,
      );
      if (generation.current === token) setRequests(result.requests);
    } catch (e: any) {
      if (generation.current === token) setError(e.message);
    } finally {
      if (generation.current === token) setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="icon-button"
        title="Инструменты текущего чата"
        aria-label="Инструменты текущего чата"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
          void load();
        }}
      >
        <Activity size={17} />
      </button>
      <dialog
        ref={dialog}
        className="chat-tools-dialog"
        onClose={() => setOpen(false)}
      >
        {open && (
          <>
            <header>
              <div>
                <h2>Инструменты чата</h2>
                <small>
                  {[context.client, context.project]
                    .filter(Boolean)
                    .join(" / ") || "Общий контекст"}{" "}
                  · Последние 20 запросов
                </small>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Закрыть"
                onClick={() => dialog.current?.close()}
              >
                <X size={20} />
              </button>
            </header>
            <p>
              Лимит расходуют вызовы модели. Операции внутри пакета показаны
              отдельно и не расходуют дополнительные вызовы. Сводка сокращена. Полный результат загружается по кнопке и показывает JSON, возвращённый инструментом; для шагов пакета — внутреннему обработчику.
            </p>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              <RefreshCw size={15} />
              {busy ? "Загрузка…" : "Обновить"}
            </button>
            {error && <p role="alert">{error}</p>}
            {!busy && !requests.length && (
              <p>В текущем контексте пока нет запросов.</p>
            )}
            {requests.map((request) => (
              <section className="chat-tool-request" key={request.id}>
                <b>
                  {new Date(request.created_at).toLocaleString()} ·{" "}
                  {statuses[request.status] || request.status}
                </b>
                <p>
                  Вызовов: {request.tool_calls}
                  {request.reason ? ` · ${request.reason}` : ""}
                </p>
                {!request.tools.length && (
                  <small>
                    Подробности не записаны: запрос сделан до добавления журнала
                    либо инструменты не вызывались.
                  </small>
                )}
                {request.tools.map((tool: any) => (
                  <details key={tool.id}>
                    <summary>
                      <code>{tool.name}</code>
                      <span>
                        {tool.internal ? "Внутри пакета · " : ""}
                        {tool.status === "running" &&
                        request.status !== "running"
                          ? "Прерван"
                          : statuses[tool.status] || tool.status}
                      </span>
                    </summary>
                    <small>
                      {new Date(tool.started_at).toLocaleTimeString()}
                      {tool.finished_at
                        ? ` · ${formatChatDuration(Date.parse(tool.finished_at) - Date.parse(tool.started_at))}`
                        : ""}
                    </small>
                    <h4>Параметры</h4>
                    <pre>{pretty(tool.arguments)}</pre>
                    <ToolResult key={`${key}:${tool.id}`} tool={tool} context={context} />
                    {tool.result && (
                      <>
                        <h4>Сводка результата</h4>
                        <pre>{pretty(tool.result)}</pre>
                      </>
                    )}
                  </details>
                ))}
              </section>
            ))}
          </>
        )}
      </dialog>
    </>
  );
}
function pretty(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function ToolResult({tool, context}: {tool: any; context: {client: string; project: string}}) {
  const [body, setBody] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!tool.hasFullResult) return <p><small>{tool.status === "running" ? "Полный результат будет доступен после завершения." : "Полный результат для этого вызова не сохранён."}</small></p>;
  async function toggle() {
    if (body !== null) { setVisible(!visible); return; }
    setBusy(true); setError("");
    try {
      const data = await api(`/conversation/tools/${encodeURIComponent(tool.id)}/result?${new URLSearchParams(context)}`);
      setBody(JSON.stringify(data.result, null, 2)); setVisible(true);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div>
    <button type="button" className="secondary" disabled={busy} aria-expanded={visible} onClick={() => void toggle()}>{busy ? "Загрузка…" : visible ? "Скрыть полный результат" : "Показать полный результат"}</button>
    {error && <p role="alert">{error}</p>}
    {visible && <><p><small>Фактический результат инструмента. Если сам инструмент ограничил данные, признаки пагинации или усечения сохранены в JSON.</small></p><pre>{body}</pre></>}
  </div>;
}
