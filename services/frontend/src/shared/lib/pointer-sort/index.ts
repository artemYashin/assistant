import { reorderOffsets } from "./layout.js";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";

type Drag = {
  from: number;
  to: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  tops: number[];
  heights: number[];
  scrollStart: number;
  scrollParent: HTMLElement;
};

/** Pointer sorting stays inside the dialog's top layer. No native drag ghost. */
export function usePointerSort(onMove: (from: number, to: number) => void) {
  const list = useRef<HTMLDivElement>(null);
  const active = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [settling, setSettling] = useState(false);
  useLayoutEffect(() => {
    if (!settling) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSettling(false));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [settling]);
  const pointer = useRef({ x: 0, y: 0 });
  const cancel = () => {
    active.current = null;
    setDrag(null);
  };
  function update() {
    const current = active.current;
    if (!current) return;
    const y =
      pointer.current.y - current.startY + current.scrollParent.scrollTop - current.scrollStart;
    const center = current.tops[current.from] + current.heights[current.from] / 2 + y;
    let to = 0;
    let distance = Infinity;
    current.tops.forEach((top, index) => {
      const next = Math.abs(center - top - current.heights[index] / 2);
      if (next < distance) {
        distance = next;
        to = index;
      }
    });
    const next = { ...current, to, x: pointer.current.x - current.startX, y };
    active.current = next;
    setDrag(next);
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active.current) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    const timer = window.setInterval(() => {
      const current = active.current;
      if (!current) return;
      const bounds = current.scrollParent.getBoundingClientRect();
      const top = Math.max(0, bounds.top),
        bottom = Math.min(window.innerHeight, bounds.bottom);
      const speed = pointer.current.y < top + 48 ? -8 : pointer.current.y > bottom - 48 ? 8 : 0;
      if (speed) {
        current.scrollParent.scrollTop += speed;
        update();
      }
    }, 16);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => {
      clearInterval(timer);
      active.current = null;
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  function start(event: PointerEvent<HTMLButtonElement>, from: number) {
    if (event.button !== 0 || !event.isPrimary || active.current || !list.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const rects = Array.from(list.current.children).map((row) => row.getBoundingClientRect());
    let parent: HTMLElement | null = list.current;
    while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY))
      parent = parent.parentElement;
    const scrollParent = parent || document.documentElement;
    pointer.current = { x: event.clientX, y: event.clientY };
    const next = {
      from,
      to: from,
      x: 0,
      y: 0,
      startX: event.clientX,
      startY: event.clientY,
      tops: rects.map((r) => r.top),
      heights: rects.map((r) => r.height),
      scrollParent,
      scrollStart: scrollParent.scrollTop,
    };
    active.current = next;
    setDrag(next);
  }
  const offsets = drag ? reorderOffsets(drag.tops, drag.heights, drag.from, drag.to) : [];
  return {
    list,
    cancel,
    dragging: !!drag,
    style(index: number) {
      // Reordering changes layout positions: clear old transforms without
      // animating them a second time from the new positions.
      if (!drag) return settling ? { transition: "none" } : undefined;
      if (index === drag.from)
        return {
          transform: `translate3d(${drag.x}px, ${drag.y}px, 0)`,
          zIndex: 2,
          transition: "none",
        };
      return { transform: `translateY(${offsets[index]}px)` };
    },
    isActive: (index: number) => drag?.from === index,
    handlers: (index: number) => ({
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => start(event, index),
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        if (active.current) {
          pointer.current = { x: event.clientX, y: event.clientY };
          update();
        }
      },
      onPointerUp: () => {
        const current = active.current;
        if (current && current.from !== current.to) setSettling(true);
        cancel();
        if (current && current.from !== current.to) onMove(current.from, current.to);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
    }),
  };
}
