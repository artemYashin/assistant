import { ImageViewer } from "./ImagePreview.js";
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { Fragment, Slice } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Bold, Italic, List, Quote, Code, Link, ImagePlus } from "lucide-react";

type EditTarget = {
  from: number;
  to: number;
  type: "link" | "image";
  url: string;
  label: string;
};
type Props = {
  notesOnly?: boolean;
  text: string;
  disabled: boolean;
  onChange: (text: string) => void;
  onImages: (files: File[]) => { src: string; alt: string }[];
  resolveImage: (src: string) => string;
};
const pencil = () => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "comment-inline-edit";
  button.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 3 5 5-13 13H3v-5Z"/><path d="m14 5 5 5"/></svg>';
  button.onmousedown = (event) => event.preventDefault();
  return button;
};
export function CommentEditor(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const picker = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"markdown" | "editor" | "preview">("editor");
  const preview = mode === "preview";
  const [viewImage, setViewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const rawInput = useRef<HTMLTextAreaElement>(null);
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [editError, setEditError] = useState("");
  const [, rerender] = useState(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, heading: false }),
      Markdown,
      Image.extend({
        addNodeView() {
          return ({ node, getPos, editor: nodeEditor }) => {
            const dom = document.createElement("span");
            dom.className = "comment-inline-image";
            const img = document.createElement("img");
            img.src = latest.current.resolveImage(node.attrs.src);
            img.alt = node.attrs.alt || "";
            if (latest.current.notesOnly) {
              const controls = document.createElement("span");
              controls.className = "note-image-controls";
              const remove = document.createElement("button");
              remove.type = "button";
              remove.title = "Удалить изображение";
              remove.setAttribute("aria-label", "Удалить изображение");
              remove.textContent = "×";
              remove.onmousedown = (e) => e.preventDefault();
              remove.onclick = () => {
                const from = getPos();
                if (from !== undefined && !latest.current.disabled)
                  nodeEditor
                    .chain()
                    .focus()
                    .deleteRange({ from, to: from + node.nodeSize })
                    .run();
              };
              const attach = document.createElement("button");
              attach.type = "button";
              attach.title = "Прикрепить изображение к чату";
              attach.setAttribute("aria-label", attach.title);
              attach.textContent = "✦";
              attach.onmousedown = (e) => e.preventDefault();
              attach.onclick = () =>
                window.dispatchEvent(
                  new CustomEvent("orbit:attach-image", {
                    detail: { src: img.src },
                  }),
                );
              img.style.cursor = "zoom-in";
              img.tabIndex = 0;
              img.setAttribute("role", "button");
              img.setAttribute(
                "aria-label",
                "Открыть изображение · масштабирование",
              );
              img.onclick = () => setViewImage({ src: img.src, alt: img.alt });
              img.onkeydown = (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setViewImage({ src: img.src, alt: img.alt });
                }
              };
              controls.append(attach, remove);
              dom.append(img, controls);
              return {
                dom,
                stopEvent: (event) =>
                  controls.contains(event.target as Node) ||
                  event.target === img,
              };
            }
            const button = pencil();
            button.setAttribute("aria-label", "Редактировать изображение");
            button.title = "Редактировать изображение";
            button.onclick = () => {
              const from = getPos();
              if (from !== undefined && !latest.current.disabled) {
                setEditError("");
                setTarget({
                  from,
                  to: from + node.nodeSize,
                  type: "image",
                  url: node.attrs.src,
                  label: node.attrs.alt || "",
                });
              }
            };
            dom.append(img, button);
            return {
              dom,
              stopEvent: (event) => button.contains(event.target as Node),
            };
          };
        },
      }),
      Extension.create({
        name: "linkEditButtons",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              props: {
                decorations(state) {
                  const decorations: Decoration[] = [];
                  let last:
                    { from: number; to: number; url: string } | undefined;
                  const links: { from: number; to: number; url: string }[] = [];
                  state.doc.descendants((node, pos) => {
                    const link = node.marks.find(
                      (mark) => mark.type.name === "link",
                    );
                    if (!node.isText || !link) return;
                    if (last && last.to === pos && last.url === link.attrs.href)
                      last.to += node.nodeSize;
                    else {
                      last = {
                        from: pos,
                        to: pos + node.nodeSize,
                        url: link.attrs.href,
                      };
                      links.push(last);
                    }
                  });
                  for (const link of links)
                    decorations.push(
                      Decoration.widget(
                        link.to,
                        () => {
                          const button = pencil();
                          button.setAttribute(
                            "aria-label",
                            "Редактировать ссылку",
                          );
                          button.title = "Редактировать ссылку";
                          button.onclick = () => {
                            if (!latest.current.disabled) {
                              setEditError("");
                              setTarget({
                                ...link,
                                type: "link",
                                label: state.doc.textBetween(
                                  link.from,
                                  link.to,
                                ),
                              });
                            }
                          };
                          return button;
                        },
                        { side: 1 },
                      ),
                    );
                  return DecorationSet.create(state.doc, decorations);
                },
              },
            }),
          ];
        },
      }),
    ],
    content: props.text,
    contentType: "markdown",
    onUpdate: ({ editor }) => latest.current.onChange(editor.getMarkdown()),
    onTransaction: () => rerender((n) => n + 1),
    editorProps: {
      attributes: {
        "aria-label": "Комментарий",
        role: "textbox",
        "aria-multiline": "true",
      },
      handleDOMEvents: {
        paste: (view, event) => {
          const files = Array.from(event.clipboardData?.files || []).filter(
            (file) => file.type.startsWith("image/"),
          );
          if (!files.length) return false;
          event.preventDefault();
          if (!view.editable) return true;
          const images = latest.current.onImages(files);
          view.dispatch(
            view.state.tr.replaceSelection(
              new Slice(
                Fragment.fromArray([
                  ...images.map((attrs) =>
                    view.state.schema.nodes.image.create(attrs),
                  ),
                  view.state.schema.nodes.paragraph.create(),
                ]),
                0,
                0,
              ),
            ),
          );
          return true;
        },
        drop: (view, event) => {
          if (!event.dataTransfer?.files.length) return false;
          event.preventDefault();
          if (!view.editable) return true;
          const images = latest.current.onImages(
            Array.from(event.dataTransfer.files),
          );
          const pos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })?.pos;
          const tr = view.state.tr;
          if (pos !== undefined)
            tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
          view.dispatch(
            tr.replaceSelection(
              new Slice(
                Fragment.fromArray([
                  ...images.map((attrs) =>
                    view.state.schema.nodes.image.create(attrs),
                  ),
                  view.state.schema.nodes.paragraph.create(),
                ]),
                0,
                0,
              ),
            ),
          );
          return true;
        },
      },
    },
  });
  useEffect(() => {
    editor?.setEditable(!props.disabled && mode === "editor" && !target, false);
  }, [editor, props.disabled, mode, target]);
  useEffect(() => {
    if (editor && props.text !== editor.getMarkdown())
      editor.commands.setContent(props.text, {
        contentType: "markdown",
        emitUpdate: false,
      });
  }, [editor, props.text]);
  if (!editor) return null;
  const actions = [
    {
      name: "Жирный",
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      name: "Курсив",
      icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      name: "Список",
      icon: List,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      name: "Цитата",
      icon: Quote,
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      name: "Код",
      icon: Code,
      active: editor.isActive("codeBlock"),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      name: "Ссылка",
      icon: Link,
      active: editor.isActive("link"),
      run: () => {
        const { from, to } = editor.state.selection;
        setEditError("");
        setTarget({
          from,
          to,
          type: "link",
          url: "https://",
          label: editor.state.doc.textBetween(from, to),
        });
      },
    },
    {
      name: "Картинка",
      icon: ImagePlus,
      active: false,
      run: () => picker.current?.click(),
    },
  ];
  function insertRawImages(files: File[]) {
    if (props.disabled) return;
    const images = props.onImages(files);
    const input = rawInput.current;
    const from = input?.selectionStart ?? props.text.length,
      to = input?.selectionEnd ?? from;
    const markdown = images
      .map((image) => `\n![${image.alt}](${image.src})\n`)
      .join("");
    if (!markdown) return;
    props.onChange(props.text.slice(0, from) + markdown + props.text.slice(to));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(from + markdown.length, from + markdown.length);
    });
  }
  function apply() {
    if (!target || !editor) return;
    if (
      !/^(https?:\/\/|mailto:)/i.test(target.url) ||
      /[\s<>]/.test(target.url)
    ) {
      setEditError("Укажите корректную ссылку https://, http:// или mailto:.");
      return;
    }
    const chain = editor.chain().focus();
    if (target.type === "image")
      chain
        .setNodeSelection(target.from)
        .updateAttributes("image", { src: target.url, alt: target.label })
        .run();
    else
      chain
        .insertContentAt(
          { from: target.from, to: target.to },
          {
            type: "text",
            text: target.label || target.url,
            marks: [{ type: "link", attrs: { href: target.url } }],
          },
        )
        .run();
    setTarget(null);
  }
  return (
    <div
      className={`comment-editor-shell ${preview ? "is-preview" : ""} ${props.disabled ? "is-busy" : ""}`}
    >
      <div
        className="comment-editor-toolbar"
        role="toolbar"
        aria-label="Форматирование комментария"
      >
        {actions.map((action) => (
          <button
            key={action.name}
            type="button"
            title={action.name}
            aria-label={action.name}
            aria-pressed={action.active}
            disabled={props.disabled || mode !== "editor" || !!target}
            onMouseDown={(event) => event.preventDefault()}
            onClick={action.run}
          >
            <action.icon size={17} />
          </button>
        ))}
        {!props.notesOnly && (
          <div
            className="comment-mode-switch"
            role="group"
            aria-label="Режим комментария"
          >
            {(
              [
                ["markdown", "Markdown"],
                ["editor", "Редактор"],
                ["preview", "Предпросмотр"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                disabled={!!target}
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {viewImage && (
        <ImageViewer
          src={viewImage.src}
          alt={viewImage.alt}
          onClose={() => setViewImage(null)}
        />
      )}
      <input
        ref={picker}
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(event) => {
          const images = props.onImages(Array.from(event.target.files || []));
          editor
            .chain()
            .focus()
            .insertContent([
              ...images.map((attrs) => ({ type: "image", attrs })),
              { type: "paragraph" },
            ])
            .run();
          event.target.value = "";
        }}
      />
      <div hidden={mode === "markdown"}>
        <EditorContent editor={editor} />
      </div>
      {mode === "markdown" && (
        <textarea
          ref={rawInput}
          className="comment-markdown-input"
          aria-label="Markdown комментария"
          value={props.text}
          disabled={props.disabled}
          placeholder="Напишите комментарий в Markdown…"
          onChange={(event) => props.onChange(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              event.preventDefault();
              insertRawImages(files);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files"))
              event.preventDefault();
          }}
          onDrop={(event) => {
            if (event.dataTransfer.files.length) {
              event.preventDefault();
              insertRawImages(Array.from(event.dataTransfer.files));
            }
          }}
        />
      )}
      {target && (
        <div
          className="comment-link-editor"
          role="group"
          aria-label={target.type === "image" ? "Изображение" : "Ссылка"}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setTarget(null);
            }
          }}
        >
          <label>
            {target.type === "image" ? "Описание изображения" : "Текст ссылки"}
            <input
              autoFocus
              value={target.label}
              onChange={(event) =>
                setTarget({ ...target, label: event.target.value })
              }
            />
          </label>
          {!target.url.startsWith("https://orbit.invalid/comment-image/") && (
            <label>
              Адрес
              <input
                value={target.url}
                onChange={(event) =>
                  setTarget({ ...target, url: event.target.value })
                }
              />
            </label>
          )}
          <div>
            <button type="button" onClick={apply}>
              Сохранить
            </button>
            <button type="button" onClick={() => setTarget(null)}>
              Отмена
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (target.type === "image")
                  editor.commands.deleteRange({
                    from: target.from,
                    to: target.to,
                  });
                else
                  editor
                    .chain()
                    .setTextSelection({ from: target.from, to: target.to })
                    .unsetLink()
                    .run();
                setTarget(null);
              }}
            >
              Удалить {target.type === "image" ? "картинку" : "ссылку"}
            </button>
          </div>
          {editError && (
            <small role="alert" className="error">
              {editError}
            </small>
          )}
        </div>
      )}
    </div>
  );
}
