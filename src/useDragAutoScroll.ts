import { useEffect, useRef, type DragEvent } from "react";

/** Keep scrolling while a native drag is held near either edge of the list. */
export function useDragAutoScroll() {
  const frame = useRef(0),
    speed = useRef(0),
    element = useRef<HTMLElement | null>(null);
  const stop = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    speed.current = 0;
    element.current = null;
  };
  useEffect(() => {
    document.addEventListener("dragend", stop);
    document.addEventListener("drop", stop);
    return () => {
      stop();
      document.removeEventListener("dragend", stop);
      document.removeEventListener("drop", stop);
    };
  }, []);
  const tick = () => {
    if (!element.current || !speed.current) {
      frame.current = 0;
      return;
    }
    element.current.scrollTop += speed.current;
    frame.current = requestAnimationFrame(tick);
  };
  return {
    stop,
    onDragOver: (event: DragEvent<HTMLElement>, active: boolean) => {
      if (!active) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const edge = Math.min(48, rect.height / 4),
        y = event.clientY;
      speed.current =
        y < rect.top + edge
          ? -Math.min(12, Math.max(2, (rect.top + edge - y) / 4))
          : y > rect.bottom - edge
            ? Math.min(12, Math.max(2, (y - rect.bottom + edge) / 4))
            : 0;
      element.current = event.currentTarget;
      if (!frame.current && speed.current)
        frame.current = requestAnimationFrame(tick);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !event.currentTarget.contains(event.relatedTarget)
      )
        stop();
    },
  };
}
