import { Children, isValidElement, useState, type ReactNode } from "react";
import { Columns3, ArrowUp, ArrowDown } from "lucide-react";
import { PrInfoPopup } from "./PrInfoPopup.js";

export const ticketColumns = [
  ["state", "Статус"],
  ["priority", "Приоритет"],
  ["tags", "Теги"],
  ["azureTags", "Azure теги"],
  ["assigned", "Исполнитель в Azure"],
  ["developer_name", "Локальное поручение"],
  ["created_at", "Дата создания"],
  ["changed_at", "Дата изменения"],
  ["added_at", "Добавлено в систему"],
  ["synced_at", "Синхронизация"],
  ["actions", "Просмотр и действия"],
] as const;
export function useTicketColumns(trash = false, namespace = "active") {
  const options: readonly (readonly [string, string])[] = trash
    ? [
        ...ticketColumns.filter(([key]) => key !== "actions"),
        ["removedAt", "Удалён"],
        ["expiresAt", "Хранится до"],
        ["actions", "Просмотр и действия"],
      ]
    : ticketColumns;
  const storageKey = `orbit.ticket-columns.${trash ? "trash" : namespace}`;
  const [order, setOrder] = useState<string[]>(() => {
    const defaults = options.map(([key]) => key);
    try {
      const saved = JSON.parse(
        localStorage.getItem(storageKey + ".order") || "[]",
      );
      if (!Array.isArray(saved)) return defaults;
      const merged = [
        ...new Set<string>(saved.filter((key) => defaults.includes(key))),
      ];
      for (const [index, key] of defaults.entries()) {
        if (merged.includes(key)) continue;
        const next = defaults
          .slice(index + 1)
          .find((candidate) => merged.includes(candidate));
        if (next) merged.splice(merged.indexOf(next), 0, key);
        else merged.push(key);
      }
      return merged;
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
    count: options.length + 3 - hidden.length,
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
