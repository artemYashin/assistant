import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function TicketSectionScroll({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const resizeDrag = useRef<{ y: number; height: number } | null>(null);
  const resizeTo = (value: number) =>
    setHeight(
      Math.max(
        window.innerHeight * 0.1,
        Math.min(window.innerHeight * 0.9, value),
      ),
    );
  const drag = useRef<{ y: number; top: number } | null>(null);
  const [metrics, setMetrics] = useState({ height: 0, total: 0, top: 0 });
  useEffect(() => {
    const node = viewport.current!;
    const measure = () =>
      setMetrics({
        height: node.clientHeight,
        total: node.scrollHeight,
        top: node.scrollTop,
      });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(content.current!);
    node.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", measure);
    };
  }, []);
  const maximum = Math.max(0, metrics.total - metrics.height);
  const overflowing = metrics.height > 0 && maximum > 1;
  const thumb = Math.min(
    metrics.height,
    Math.max(28, (metrics.height * metrics.height) / (metrics.total || 1)),
  );
  const travel = Math.max(1, metrics.height - thumb);
  const offset = maximum
    ? Math.min(travel, (metrics.top / maximum) * travel)
    : 0;
  return (
    <>
      <div
        className={`ticket-scroll-shell${overflowing ? " has-overflow" : ""}`}
      >
        <div
          id={id}
          ref={viewport}
          className={`ticket-section-scroll${height !== null ? " is-resized" : ""}`}
          style={height !== null ? { height } : undefined}
          role="region"
          aria-label={label}
          tabIndex={0}
        >
          <div ref={content}>{children}</div>
        </div>
        {overflowing && (
          <div
            className="ticket-scroll-track"
            style={{ height: metrics.height }}
            role="scrollbar"
            aria-label={`Прокрутка: ${label}`}
            aria-controls={id}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={Math.round(maximum)}
            aria-valuenow={Math.round(
              Math.min(maximum, Math.max(0, metrics.top)),
            )}
            tabIndex={0}
            onKeyDown={(event) => {
              const node = viewport.current!;
              const steps: Record<string, number> = {
                ArrowDown: 40,
                ArrowUp: -40,
                PageDown: node.clientHeight,
                PageUp: -node.clientHeight,
                " ": event.shiftKey ? -node.clientHeight : node.clientHeight,
              };
              if (event.key in steps) {
                event.preventDefault();
                node.scrollTop += steps[event.key];
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                node.scrollTop = event.key === "Home" ? 0 : maximum;
              }
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              event.currentTarget.setPointerCapture(event.pointerId);
              const node = viewport.current!;
              if (!(event.target as Element).closest(".ticket-scroll-thumb")) {
                const y =
                  event.clientY -
                  event.currentTarget.getBoundingClientRect().top;
                node.scrollTop =
                  Math.max(0, Math.min(1, (y - thumb / 2) / travel)) * maximum;
              }
              drag.current = { y: event.clientY, top: node.scrollTop };
            }}
            onPointerMove={(event) => {
              if (drag.current)
                viewport.current!.scrollTop =
                  drag.current.top +
                  ((event.clientY - drag.current.y) / travel) * maximum;
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
          >
            <span
              className="ticket-scroll-thumb"
              style={{ height: thumb, transform: `translateY(${offset}px)` }}
            />
          </div>
        )}
      </div>
      <div
        className="ticket-section-resize"
        role="separator"
        aria-label={`Высота блока: ${label}`}
        aria-controls={id}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={90}
        aria-valuenow={Math.max(
          0,
          Math.min(90, Math.round((metrics.height / window.innerHeight) * 100)),
        )}
        aria-valuetext={`${Math.round(metrics.height)} пикселей`}
        tabIndex={0}
        title="Потяните, чтобы изменить высоту. Двойной клик — сбросить"
        onDoubleClick={() => setHeight(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            resizeTo(
              viewport.current!.clientHeight +
                (event.key === "ArrowDown" ? 40 : -40),
            );
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            resizeTo(window.innerHeight * (event.key === "Home" ? 0.1 : 0.9));
          } else if (event.key === "Enter") {
            event.preventDefault();
            setHeight(null);
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeDrag.current = {
            y: event.clientY,
            height: viewport.current!.clientHeight,
          };
        }}
        onPointerMove={(event) => {
          if (resizeDrag.current)
            resizeTo(
              resizeDrag.current.height + event.clientY - resizeDrag.current.y,
            );
        }}
        onPointerUp={() => {
          resizeDrag.current = null;
        }}
        onPointerCancel={() => {
          resizeDrag.current = null;
        }}
        onLostPointerCapture={() => {
          resizeDrag.current = null;
        }}
      >
        <span aria-hidden="true" />
      </div>
    </>
  );
}
