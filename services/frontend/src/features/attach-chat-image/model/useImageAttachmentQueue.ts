import { useEffect, useRef } from "react";
import { api } from "../../../shared/api/http/index.js";
type Options = {
  context: { client: string; project: string };
  sessionId: string;
  working: boolean;
  clearing: boolean;
  onExpand: () => void;
  onError: (text: string) => void;
  onPending: (count: number) => void;
  add: (files: File[], ids?: string[]) => void;
};
type Prepared = { file: File } | { error: string };
type Job = {
  src: string;
  context: string;
  session: string;
  prepared?: Promise<Prepared>;
};
function localImage(src: string) {
  const u = new URL(src, window.location.href);
  return (
    src.startsWith("blob:") ||
    src.startsWith("data:image/") ||
    (u.origin === window.location.origin &&
      /^\/api\/(?:notes\/[0-9a-f-]+\/images\/[0-9a-f-]+|ticket-note-images\/[0-9a-f-]+)$/.test(
        u.pathname,
      ))
  );
}
async function capture(src: string): Promise<Prepared> {
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error("Не удалось прочитать изображение.");
    const blob = await response.blob();
    return {
      file: new File(
        [blob],
        "image." + (blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1]),
        { type: blob.type },
      ),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
export function useImageAttachmentQueue(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const queue = useRef<Job[]>([]),
    running = useRef(false),
    alive = useRef(true);
  const contextKey = JSON.stringify(options.context);
  const drain = async () => {
    if (running.current || !alive.current) return;
    running.current = true;
    try {
      while (queue.current.length && alive.current) {
        const current = latest.current,
          job = queue.current[0];
        if (
          job.context !== JSON.stringify(current.context) ||
          (job.session && current.sessionId && job.session !== current.sessionId)
        ) {
          queue.current.shift();
          current.onPending(queue.current.length);
          current.onError(
            "Прикрепление отменено: выбран другой чат или проект. Прикрепите картинку в нужный чат.",
          );
          continue;
        }
        if (current.working || current.clearing || !current.sessionId) break;
        job.session = current.sessionId;
        try {
          let file: File, uploadedId: string | undefined;
          if (job.prepared) {
            const prepared = await job.prepared;
            if ("error" in prepared) throw new Error(prepared.error);
            file = prepared.file;
          } else {
            const u = new URL(job.src, window.location.href),
              url = u.origin === window.location.origin ? u.pathname + u.search : u.href;
            const result = await api("/conversation/image", "POST", {
              ...current.context,
              sessionId: job.session,
              url,
            });
            uploadedId = result.id;
            const response = await fetch(
              "/api/conversation/files/" +
                encodeURIComponent(result.id) +
                "?" +
                new URLSearchParams({
                  ...current.context,
                  sessionId: job.session,
                }),
              { credentials: "same-origin" },
            );
            if (!response.ok) throw new Error("Не удалось загрузить вложение для предпросмотра.");
            const blob = await response.blob();
            file = new File([blob], result.name, { type: blob.type });
          }
          const now = latest.current;
          if (!alive.current) break;
          if (JSON.stringify(now.context) !== job.context || now.sessionId !== job.session)
            throw new Error("Прикрепление отменено: выбран другой чат или проект.");
          // A response may have started during the download. Keep the captured file queued.
          if (now.working || now.clearing) {
            job.prepared = Promise.resolve({ file });
            break;
          }
          now.add([file], uploadedId ? [uploadedId] : []);
        } catch (e) {
          if (alive.current) latest.current.onError(e instanceof Error ? e.message : String(e));
        }
        queue.current.shift();
        if (alive.current) latest.current.onPending(queue.current.length);
      }
    } finally {
      running.current = false;
    }
  };
  const drainRef = useRef(drain);
  drainRef.current = drain;
  useEffect(() => {
    alive.current = true;
    const handle = (event: Event) => {
      const src = (event as CustomEvent).detail?.src;
      if (typeof src !== "string") return;
      const current = latest.current;
      current.onExpand();
      current.onError("");
      if (queue.current.length >= 10) {
        current.onError("В очереди уже 10 изображений. Дождитесь их прикрепления.");
        return;
      }
      try {
        queue.current.push({
          src,
          context: JSON.stringify(current.context),
          session: current.sessionId,
          prepared: localImage(src) ? capture(src) : undefined,
        });
        current.onPending(queue.current.length);
        void drainRef.current();
      } catch (e) {
        current.onError(e instanceof Error ? e.message : String(e));
      }
    };
    window.addEventListener("orbit:attach-image", handle);
    return () => {
      alive.current = false;
      queue.current = [];
      window.removeEventListener("orbit:attach-image", handle);
    };
  }, []);
  useEffect(() => {
    void drainRef.current();
  }, [contextKey, options.sessionId, options.working, options.clearing]);
}
