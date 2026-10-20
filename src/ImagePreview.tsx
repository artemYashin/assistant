import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Expand, LoaderCircle, Minus, Plus, X } from "lucide-react";

export function ImagePreview({
  src,
  alt = "Изображение",
  className = "",
  children,
  thumbnail = true,
}: {
  src: string;
  alt?: string;
  className?: string;
  children?: ReactNode;
  thumbnail?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setOpen(false);
  }, [src]);
  return (
    <>
      <a
        href={src}
        className={`image-preview-trigger ${className}`}
        title="Открыть изображение · масштабирование"
        aria-haspopup="dialog"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {children ??
          (thumbnail && !failed ? (
            <img
              src={src}
              alt={alt}
              loading="lazy"
              onError={() => setFailed(true)}
            />
          ) : (
            <span>
              {alt}
              {failed ? " · повторить просмотр" : " · открыть изображение"}
            </span>
          ))}
      </a>
      {open &&
        createPortal(
          <ImageViewer src={src} alt={alt} onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}
function ImageViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(false);
  const drag = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const fit =
    natural.width && size.width
      ? Math.min(
          1,
          (size.width - 24) / natural.width,
          (size.height - 24) / natural.height,
        )
      : 1;
  const scale = Math.max(0.001, fit) * zoom;
  const maxZoom = Math.max(8, 1 / Math.max(0.001, fit));
  const maxX = Math.max(0, (natural.width * scale - size.width) / 2 + 12);
  const maxY = Math.max(0, (natural.height * scale - size.height) / 2 + 12);
  const x = Math.max(-maxX, Math.min(maxX, pan.x));
  const y = Math.max(-maxY, Math.min(maxY, pan.y));
  const ready = natural.width > 0 && !error;
  useEffect(() => {
    setPan((current) => ({
      x: Math.max(-maxX, Math.min(maxX, current.x)),
      y: Math.max(-maxY, Math.min(maxY, current.y)),
    }));
  }, [maxX, maxY]);
  useEffect(() => {
    dialog.current?.showModal();
    const node = stage.current!;
    const observer = new ResizeObserver(() =>
      setSize({ width: node.clientWidth, height: node.clientHeight }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = stage.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!ready) return;
      setZoom((value) =>
        Math.max(
          0.25,
          Math.min(
            maxZoom,
            value *
              Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002),
          ),
        ),
      );
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [ready, maxZoom]);
  function adjust(factor: number) {
    setZoom((value) => Math.max(0.25, Math.min(maxZoom, value * factor)));
  }
  function reset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }
  function endDrag() {
    drag.current = null;
    setDragging(false);
  }
  return (
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-label={`Просмотр: ${alt}`}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="image-viewer-toolbar">
        <strong title={alt}>{alt}</strong>
        <div className="image-viewer-controls">
          <button
            type="button"
            className="icon-button"
            disabled={!ready || zoom <= 0.25}
            title="Уменьшить"
            aria-label="Уменьшить изображение"
            onClick={() => adjust(1 / 1.25)}
          >
            <Minus size={19} />
          </button>
          <output aria-live="polite">
            {ready ? `${Math.round(scale * 100)}%` : "—"}
          </output>
          <button
            type="button"
            className="icon-button"
            disabled={!ready || zoom >= maxZoom}
            title="Увеличить"
            aria-label="Увеличить изображение"
            onClick={() => adjust(1.25)}
          >
            <Plus size={19} />
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={!ready}
            title="Вписать в окно"
            aria-label="Вписать изображение в окно"
            onClick={reset}
          >
            <Expand size={18} />
          </button>
          <button
            type="button"
            className="text-button"
            disabled={!ready}
            title="Исходный размер"
            onClick={() => {
              setZoom(1 / Math.max(0.001, fit));
              setPan({ x: 0, y: 0 });
            }}
          >
            1:1
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть просмотр изображения"
            title="Закрыть · Esc"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
      </header>
      <div
        ref={stage}
        className={`image-viewer-stage${dragging ? " is-dragging" : ""}`}
        tabIndex={0}
        aria-label="Изображение. Колесо мыши — масштаб, перетаскивание — перемещение, стрелки — перемещение, 0 — вписать"
        onDoubleClick={reset}
        onKeyDown={(event) => {
          if (!ready) return;
          if (
            [
              "+",
              "=",
              "-",
              "0",
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
            ].includes(event.key)
          )
            event.preventDefault();
          if (event.key === "+" || event.key === "=") adjust(1.25);
          if (event.key === "-") adjust(1 / 1.25);
          if (event.key === "0") reset();
          if (event.key.startsWith("Arrow"))
            setPan({
              x:
                x +
                (event.key === "ArrowLeft"
                  ? 40
                  : event.key === "ArrowRight"
                    ? -40
                    : 0),
              y:
                y +
                (event.key === "ArrowUp"
                  ? 40
                  : event.key === "ArrowDown"
                    ? -40
                    : 0),
            });
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !ready) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            panX: x,
            panY: y,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setPan({
              x: Math.max(
                -maxX,
                Math.min(
                  maxX,
                  drag.current.panX + event.clientX - drag.current.x,
                ),
              ),
              y: Math.max(
                -maxY,
                Math.min(
                  maxY,
                  drag.current.panY + event.clientY - drag.current.y,
                ),
              ),
            });
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        {!ready && !error && (
          <span className="image-viewer-message" role="status">
            <LoaderCircle size={22} className="spin" /> Загружаю изображение…
          </span>
        )}
        {error && (
          <p className="image-viewer-message" role="alert">
            Не удалось загрузить изображение. Проверьте доступ к вложению и
            подключение.
          </p>
        )}
        {!error && (
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setError(true)}
            style={{
              width: natural.width ? natural.width * scale : undefined,
              height: natural.height ? natural.height * scale : undefined,
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
              visibility: ready ? "visible" : "hidden",
            }}
          />
        )}
      </div>
      <footer>
        Колесо мыши — масштаб · Перетаскивание — перемещение · Двойной клик —
        вписать · Esc — закрыть
      </footer>
    </dialog>
  );
}
