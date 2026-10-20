import { Children, isValidElement, useState, type ReactNode } from "react";
import { Columns3, ArrowUp, ArrowDown } from "lucide-react";
import { PrInfoPopup } from "./PrInfoPopup.js";

export const ticketColumns = [
  ["state", "Статус"],
  ["priority", "Приоритет"],
  ["tags", "Теги"],
  ["assigned", "Исполнитель в Azure"],
  ["developer_name", "Локальное поручение"],
  ["synced_at", "Синхронизация"],
  ["actions", "Просмотр и действия"],
] as const;
export function useTicketColumns(trash = false) {
  const options: readonly (readonly [string, string])[] = trash
    ? [
        ...ticketColumns.filter(
          ([key]) => !["synced_at", "actions"].includes(key),
        ),
        ["removedAt", "Удалён"],
        ["expiresAt", "Хранится до"],
        ["actions", "Просмотр и действия"],
      ]
    : ticketColumns;
  const storageKey = `orbit.ticket-columns.${trash ? "trash" : "active"}`;
  const [order, setOrder] = useState<string[]>(() => {
    const defaults = options.map(([key]) => key);
    try {
      const saved = JSON.parse(
        localStorage.getItem(storageKey + ".order") || "[]",
      );
      return Array.isArray(saved)
        ? [
            ...new Set([
              ...saved.filter((key) => defaults.includes(key)),
              ...defaults,
            ]),
          ]
        : defaults;
    } catch {
      return defaults;
    }
  });
  const saveOrder = (next: string[]) => {
    setOrder(next);
    try {
      localStorage.setItem(storageKey + ".order", JSON.stringify(next));
    } catch {
      /* Browser storage is optional. */
    }
  };
  const move = (index: number, delta: number) => {
    const next = [...order];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    saveOrder(next);
  };
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(saved)
        ? saved.filter((key) => options.some(([id]) => id === key))
        : [];
    } catch {
      return [];
    }
  });
  const save = (next: string[]) => {
    setHidden(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Still usable without browser storage. */
    }
  };
  return {
    order,
    hidden: (key: string) => hidden.includes(key),
    count: (trash ? 11 : 9) - hidden.length,
    control: (
      <PrInfoPopup
        title="Отображение столбцов"
        className="secondary ticket-display-button"
        trigger={
          <>
            <Columns3 size={16} />
            Отображение
          </>
        }
      >
        <p className="muted">
          ID и название тикета остаются первыми. Стрелки меняют порядок
          остальных столбцов. Настройка не меняет фильтры и экспорт.
        </p>
        <div className="ticket-column-options">
          {order.map((key, index) => {
            const label = options.find(([id]) => id === key)![1];
            return (
              <div className="ticket-column-option" key={key}>
                <label>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(key)}
                    onChange={(event) =>
                      save(
                        event.target.checked
                          ? hidden.filter((id) => id !== key)
                          : [...hidden, key],
                      )
                    }
                  />
                  {label}
                </label>
                <span className="ticket-column-move">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Переместить выше: ${label}`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Переместить ниже: ${label}`}
                    disabled={index === order.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={16} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <button type="button" className="secondary" onClick={() => save([])}>
          Показать все
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => saveOrder(options.map(([key]) => key))}
        >
          Сбросить порядок
        </button>
      </PrInfoPopup>
    ),
  };
}

export function OrderedTicketCells({
  children,
  order,
}: {
  children: ReactNode;
  order: string[];
}) {
  const rank = (child: ReactNode) => {
    if (!isValidElement<{ "data-column"?: string }>(child)) return -1;
    const key = child.props["data-column"];
    return key ? order.indexOf(key) : -1;
  };
  return <>{Children.toArray(children).sort((a, b) => rank(a) - rank(b))}</>;
}
