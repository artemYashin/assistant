import { useState, useEffect } from "react";
import { Send } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { CommentEditor } from "../../../entities/rich-content/editor/index.js";

type ImageDraft = { id: string; file: File; preview: string; url?: string };
type Draft = {
  text: string;
  images: ImageDraft[];
  requestId: string;
  busy: boolean;
  listeners: Set<() => void>;
};
const drafts = new Map<string, Draft>();
const marker = (id: string) => `https://orbit.invalid/comment-image/${id}`;
export function TicketCommentForm({
  reference,
  draftKey,
}: {
  reference: string;
  draftKey: string;
}) {
  const [draft] = useState(() => {
    let value = drafts.get(draftKey);
    if (!value) {
      value = {
        text: "",
        images: [],
        requestId: crypto.randomUUID(),
        busy: false,
        listeners: new Set(),
      };
      drafts.set(draftKey, value);
    }
    return value;
  });
  const [, render] = useState(0);
  const [error, setError] = useState(""),
    [sent, setSent] = useState(false);
  useEffect(() => {
    const listener = () => render((n) => n + 1);
    draft.listeners.add(listener);
    return () => {
      draft.listeners.delete(listener);
    };
  }, [draft]);
  const refresh = () => draft.listeners.forEach((listener) => listener());
  const change = (text: string) => {
    if (text === draft.text) return;
    draft.text = text;
    draft.requestId = crypto.randomUUID();
    setSent(false);
    refresh();
  };
  function add(files: File[]) {
    if (draft.busy) return [];
    setError("");
    const added: { src: string; alt: string }[] = [];
    for (const file of files) {
      if (
        !/^image\/(png|jpeg|gif|webp)$/.test(file.type) ||
        file.size > 10 * 1024 * 1024 ||
        !file.size
      ) {
        setError("Поддерживаются PNG, JPEG, GIF и WebP до 10 МБ.");
        continue;
      }
      if (
        draft.images.filter((image) => draft.text.includes(marker(image.id))).length +
          added.length >=
        10
      ) {
        setError("В комментарий можно добавить до 10 изображений.");
        break;
      }
      const image = {
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
      };
      draft.images.push(image);
      added.push({ src: marker(image.id), alt: "Изображение" });
    }
    return added;
  }
  async function send() {
    if (draft.busy || !draft.text.trim()) return;
    draft.busy = true;
    setError("");
    setSent(false);
    refresh();
    try {
      const used = draft.images.filter((image) => draft.text.includes(marker(image.id)));
      for (const image of used) {
        if (image.url) continue;
        const body = new FormData();
        body.append("image", image.file);
        body.append("uploadId", image.id);
        const result = await api(
          `/ticket-cards/${encodeURIComponent(reference)}/comment-images`,
          "POST",
          body,
        );
        image.url = result.url;
        refresh();
      }
      let text = draft.text;
      for (const image of used) text = text.replaceAll(marker(image.id), image.url!);
      if (text.length > 10000)
        throw new Error(
          "Комментарий со ссылками на картинки превышает 10000 символов. Сократите текст.",
        );
      const result = await api(`/ticket-cards/${encodeURIComponent(reference)}/comments`, "POST", {
        text,
        markdown: true,
        imageUploads: used.map((image) => image.id),
        requestId: draft.requestId,
      });
      window.dispatchEvent(new CustomEvent("orbit:ticket-comment", { detail: result }));
      draft.images.forEach((image) => URL.revokeObjectURL(image.preview));
      draft.images = [];
      change("");
      setSent(true);
    } catch (e: any) {
      setError(`${e.message} Черновик и загруженные ссылки сохранены; можно повторить отправку.`);
    } finally {
      draft.busy = false;
      refresh();
    }
  }
  return (
    <form
      className="ticket-comment-form"
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.stopPropagation();
        const element = event.target as HTMLElement;
        if (!(element instanceof HTMLTextAreaElement) && !element.isContentEditable)
          event.preventDefault();
      }}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <CommentEditor
        text={draft.text}
        disabled={draft.busy}
        onChange={change}
        onImages={add}
        resolveImage={(src) =>
          draft.images.find((image) => marker(image.id) === src)?.preview || src
        }
      />
      <div className="ticket-comment-form-actions">
        <small className="muted">
          Картинки загружаются в Azure только при отправке. До 10 файлов по 10 МБ.
        </small>
        <button
          type="button"
          onClick={() => void send()}
          className="primary"
          disabled={draft.busy || !draft.text.trim()}
        >
          <Send size={15} />
          {draft.busy ? "Отправка…" : "Отправить"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {sent && <p role="status">Комментарий отправлен.</p>}
    </form>
  );
}
