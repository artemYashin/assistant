import { useLayoutEffect, useRef } from "react";

/** Clip without a scroll ancestor so CSS sticky follows the page, not the board. */
export function useKanbanScroll() {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const scrollbar = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const view = viewport.current;
    const content = track.current;
    const bar = scrollbar.current;
    const space = spacer.current;
    if (!view || !content || !bar || !space) return;
    const sync = () => {
      content.style.transform = `translateX(${-bar.scrollLeft}px)`;
    };
    const resize = () => {
      space.style.width = `${content.scrollWidth}px`;
      sync();
    };
    const wheel = (event: WheelEvent) => {
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!delta || bar.scrollWidth <= bar.clientWidth) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.clientWidth : 1;
      bar.scrollLeft += delta * unit;
      sync();
      // A diagonal trackpad gesture must still scroll the document vertically.
      if (event.deltaX && event.deltaY && !event.shiftKey) window.scrollBy(0, event.deltaY * unit);
    };
    let touch: { x: number; y: number; left: number } | null = null;
    const touchStart = (event: TouchEvent) => {
      const point = event.touches[0];
      touch =
        event.touches.length === 1
          ? { x: point.clientX, y: point.clientY, left: bar.scrollLeft }
          : null;
    };
    const touchMove = (event: TouchEvent) => {
      if (!touch || event.touches.length !== 1) return;
      const point = event.touches[0];
      const dx = touch.x - point.clientX;
      if (Math.abs(dx) <= Math.abs(touch.y - point.clientY) || bar.scrollWidth <= bar.clientWidth)
        return;
      event.preventDefault();
      bar.scrollLeft = touch.left + dx;
      sync();
    };
    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const bounds = view.getBoundingClientRect();
      const item = event.target.getBoundingClientRect();
      bar.scrollLeft +=
        item.left < bounds.left ? item.left - bounds.left : Math.max(0, item.right - bounds.right);
      sync();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(view);
    observer.observe(content);
    view.addEventListener("wheel", wheel, { passive: false });
    bar.addEventListener("scroll", sync);
    view.addEventListener("touchstart", touchStart, { passive: true });
    view.addEventListener("touchmove", touchMove, { passive: false });
    view.addEventListener("focusin", focus);
    resize();
    return () => {
      observer.disconnect();
      view.removeEventListener("wheel", wheel);
      bar.removeEventListener("scroll", sync);
      view.removeEventListener("touchstart", touchStart);
      view.removeEventListener("touchmove", touchMove);
      view.removeEventListener("focusin", focus);
    };
  }, []);
  return { viewport, track, scrollbar, spacer };
}
