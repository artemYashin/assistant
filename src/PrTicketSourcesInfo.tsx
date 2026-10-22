import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

export function PrTicketSourcesInfo() {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const show = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, window.innerWidth - 24);
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: rect.top, width });
  };
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [position]);
  return <>
    <button ref={trigger} type="button" className="pr-ticket-sources-info"
      aria-label="Откуда берутся связанные тикеты" aria-describedby={position ? id : undefined}
      onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setPosition(null); } }}
      onClick={event => { event.preventDefault(); event.stopPropagation(); show(); }}>
      <Info size={15} aria-hidden="true" />
    </button>
    {position && createPortal(<div id={id} role="tooltip" className="pr-ticket-sources-tooltip"
      style={{ left: position.left, width: position.width, ...(position.top > 190 ? { bottom: window.innerHeight - position.top + 8 } : { top: position.top + 30 }) }}>
      <strong>Источники связанных тикетов</strong>
      <p>#номер в названии и описании PR, явные связи PR в Azure и связи, добавленные вручную в Orbit.</p>
      <p>Коммиты и связи между тикетами не просматриваются. Локальное отключение исключает тикет из merge и ревью, не меняя Azure.</p>
    </div>, document.body)}
  </>;
}
