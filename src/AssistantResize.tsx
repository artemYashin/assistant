import { useEffect, useRef, useState } from "react";
export function readChatPreference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveChatPreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage may be unavailable. */
  }
}
export function useAssistantResize() {
  const [width, setWidth] = useState(() => {
    const value = Number(readChatPreference("orbit.chat.width", "355"));
    return Number.isFinite(value) ? Math.max(280, Math.min(800, value)) : 355;
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  const start = useRef<{ x: number; width: number } | null>(null);
  const max = Math.max(
    280,
    Math.min(800, viewport <= 800 ? viewport - 56 : Math.floor(viewport * 0.6)),
  );
  const effective = Math.min(width, max);
  const update = (value: number) =>
    setWidth(Math.max(280, Math.min(max, value)));
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(
    () => saveChatPreference("orbit.chat.width", String(width)),
    [width],
  );
  return {
    width: effective,
    handle: (
      <div
        className="assistant-resize"
        role="separator"
        tabIndex={0}
        aria-label="Ширина чата"
        aria-orientation="vertical"
        aria-valuemin={280}
        aria-valuemax={max}
        aria-valuenow={effective}
        aria-controls="assistant-panel"
        title="Перетащите для изменения ширины. Стрелки ← → также работают; двойной щелчок — сброс."
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          start.current = { x: e.clientX, width: effective };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          if (start.current)
            update(start.current.width + start.current.x - e.clientX);
        }}
        onPointerUp={(e) => {
          start.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
        onLostPointerCapture={() => {
          start.current = null;
        }}
        onDoubleClick={() => update(355)}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          update(
            e.key === "Home"
              ? 280
              : e.key === "End"
                ? max
                : effective + (e.key === "ArrowLeft" ? 20 : -20),
          );
        }}
      />
    ),
  };
}
