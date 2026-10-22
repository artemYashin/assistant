import { useRef, useState, useId, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, ImagePlus, X } from "lucide-react";
import { api } from "./api.js";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock.js";

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
  const [preview, setPreview] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null),
    picker = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    const listener = () => render((n) => n + 1);
    draft.listeners.add(listener);
    return () => {
      draft.listeners.delete(listener);
    };
  }, [draft]);
  const refresh = () => draft.listeners.forEach((listener) => listener());
  const change = (text: string) => {
    draft.text = text;
    draft.requestId = crypto.randomUUID();
    setSent(false);
    refresh();
  };
  function insert(before: string, after = "") {
    const start = input.current?.selectionStart ?? draft.text.length,
      end = input.current?.selectionEnd ?? start;
    change(
      draft.text.slice(0, start) +
        before +
        draft.text.slice(start, end) +
        after +
        draft.text.slice(end),
    );
    setPreview(false);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        start + before.length,
        end + before.length,
      );
    });
  }
  function add(files: File[]) {
    if (draft.busy) return;
    setError("");
    let markdown = "";
    for (const file of files) {
      if (
        !/^image\/(png|jpeg|gif|webp)$/.test(file.type) ||
        file.size > 10 * 1024 * 1024 ||
        !file.size
      ) {
        setError("Поддерживаются PNG, JPEG, GIF и WebP до 10 МБ.");
        continue;
      }
      if (draft.images.length >= 10) {
        setError("В комментарий можно добавить до 10 изображений.");
        break;
      }
      const image = {
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
      };
      draft.images.push(image);
      markdown += `\n![Изображение](${marker(image.id)})\n`;
    }
    if (markdown) insert(markdown);
  }
  async function send() {
    if (draft.busy || !draft.text.trim()) return;
    draft.busy = true;
    setError("");
    setSent(false);
    refresh();
    try {
      const used = draft.images.filter((image) =>
        draft.text.includes(marker(image.id)),
      );
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
      for (const image of used)
        text = text.replaceAll(marker(image.id), image.url!);
      if (text.length > 10000)
        throw new Error(
          "Комментарий со ссылками на картинки превышает 10000 символов. Сократите текст.",
        );
      const result = await api(
        `/ticket-cards/${encodeURIComponent(reference)}/comments`,
        "POST",
        {
          text,
          markdown: true,
          imageUploads: used.map((image) => image.id),
          requestId: draft.requestId,
        },
      );
      window.dispatchEvent(
        new CustomEvent("orbit:ticket-comment", { detail: result }),
      );
      draft.images.forEach((image) => URL.revokeObjectURL(image.preview));
      draft.images = [];
      change("");
      setSent(true);
      setPreview(false);
    } catch (e: any) {
      setError(
        `${e.message} Черновик и загруженные ссылки сохранены; можно повторить отправку.`,
      );
    } finally {
      draft.busy = false;
      refresh();
    }
  }
  return (
    <form
      className="ticket-comment-form"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          add(Array.from(event.dataTransfer.files));
        }
      }}
    >
      <label htmlFor={id}>Новый комментарий · Markdown</label>
      <div className="comment-editor-toolbar">
        {[
          ["Жирный", "**", "**"],
          ["Курсив", "_", "_"],
          ["Список", "\n- ", ""],
          ["Цитата", "\n> ", ""],
          ["Код", "\n```\n", "\n```\n"],
          ["Ссылка", "[", "](https://)"],
        ].map(([label, before, after]) => (
          <button
            type="button"
            key={label}
            disabled={draft.busy}
            onClick={() => insert(before, after)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={draft.busy}
          onClick={() => picker.current?.click()}
        >
          <ImagePlus size={15} />
          Картинка
        </button>
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          {preview ? "Редактировать" : "Предпросмотр"}
        </button>
      </div>
      <input
        ref={picker}
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(event) => {
          add(Array.from(event.target.files || []));
          event.target.value = "";
        }}
      />
      {preview ? (
        <div className="comment-editor-preview memory-markdown">
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              pre: MarkdownCodeBlock,
              img: ({ src, alt }) => (
                <img
                  src={
                    draft.images.find((image) => marker(image.id) === src)
                      ?.preview || src
                  }
                  alt={alt}
                />
              ),
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {draft.text || "Предпросмотр комментария"}
          </Markdown>
        </div>
      ) : (
        <textarea
          id={id}
          ref={input}
          rows={6}
          maxLength={10000}
          value={draft.text}
          disabled={draft.busy}
          placeholder="Напишите комментарий. Вставьте картинку из буфера или перетащите её сюда…"
          onChange={(event) => change(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              event.preventDefault();
              add(files);
            }
          }}
        />
      )}
      {!!draft.images.length && (
        <div className="comment-editor-images">
          {draft.images.map((image) => (
            <div key={image.id}>
              <img src={image.preview} alt={image.file.name} />
              <span title={image.file.name}>{image.file.name}</span>
              <small>
                {image.url ? "Загружено в Azure" : "Ещё не загружено"}
              </small>
              <button
                type="button"
                aria-label={`Удалить ${image.file.name}`}
                disabled={draft.busy}
                onClick={() => {
                  draft.images = draft.images.filter((item) => item !== image);
                  URL.revokeObjectURL(image.preview);
                  change(
                    draft.text
                      .replaceAll(`![Изображение](${marker(image.id)})`, "")
                      .replaceAll(marker(image.id), ""),
                  );
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="ticket-comment-form-actions">
        <small className="muted">
          Картинки загружаются в Azure только при отправке. До 10 файлов по 10
          МБ.
        </small>
        <button
          type="submit"
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
