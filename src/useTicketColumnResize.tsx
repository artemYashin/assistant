import { useEffect, useRef, useState } from "react";
import {
  fitColumnWidths,
  parseColumnWidths,
  resizeColumnPair,
} from "./ticket-column-widths.js";

export function useTicketColumnResize(storageKey: string, keys: string[]) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [saved, setSaved] = useState<Record<string, number>>(() => {
    try {
      return parseColumnWidths(
        JSON.parse(localStorage.getItem(storageKey) || "{}"),
      );
    } catch {
      return {};
    }
  });
  const current = useRef(saved);
  const drag = useRef<{
    x: number;
    key: string;
    next: string;
    widths: Record<string, number>;
    before: Record<string, number>;
  } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [available, setAvailable] = useState(1000);
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const observer = new ResizeObserver(() =>
      setAvailable(Math.max(100, table.getBoundingClientRect().width)),
    );
    observer.observe(table);
    setAvailable(Math.max(100, table.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);
  const manual = Object.keys(saved).length > 0;
  const widths = fitColumnWidths(keys, saved, available);
  const update = (value: Record<string, number>, persist = false) => {
    current.current = value;
    setSaved(value);
    if (persist) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        /* Optional browser storage. */
      }
    }
  };
  const reset = () => {
    drag.current = null;
    setActive(null);
    update({}, true);
  };
  const measure = () =>
    Object.fromEntries(
      Array.from(
        tableRef.current?.querySelectorAll<HTMLTableCellElement>(
          "thead th[data-resize-key]:not([hidden])",
        ) || [],
      ).map((cell) => [
        cell.dataset.resizeKey!,
        cell.getBoundingClientRect().width,
      ]),
    );
  return {
    tableRef,
    manual,
    reset,
    colgroup: manual ? (
      <colgroup>
        {keys.map((key) => (
          <col
            key={key}
            style={{ width: `${(widths[key] / available) * 100}%` }}
          />
        ))}
      </colgroup>
    ) : null,
    handle: (key: string, label: string) => {
      const next = keys[keys.indexOf(key) + 1];
      if (key === "selection" || !next || !keys.includes(key)) return null;
      return (
        <span
          className={`ticket-column-resize${active === key ? " is-active" : ""}`}
          role="separator"
          tabIndex={0}
          aria-label={`Ширина столбца: ${label}`}
          aria-orientation="vertical"
          aria-valuenow={Math.round(widths[key])}
          title="Потяните границу. ← → — изменить ширину. Двойной щелчок — сбросить все ширины."
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.stopPropagation();
            reset();
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const measured = measure();
            drag.current = {
              x: event.clientX,
              key,
              next,
              widths: measured,
              before: current.current,
            };
            setActive(key);
            update({ ...current.current, ...measured });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            update({
              ...current.current,
              ...resizeColumnPair(
                start.widths,
                start.key,
                start.next,
                event.clientX - start.x,
              ),
            });
          }}
          onPointerUp={(event) => {
            if (!drag.current) return;
            drag.current = null;
            setActive(null);
            update(current.current, true);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            if (drag.current) update(drag.current.before);
            drag.current = null;
            setActive(null);
          }}
          onLostPointerCapture={() => {
            if (drag.current) update(drag.current.before);
            drag.current = null;
            setActive(null);
          }}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key))
              return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Home") {
              reset();
              return;
            }
            update(
              {
                ...current.current,
                ...resizeColumnPair(
                  measure(),
                  key,
                  next,
                  event.key === "ArrowRight" ? 12 : -12,
                ),
              },
              true,
            );
          }}
        />
      );
    },
  };
}
