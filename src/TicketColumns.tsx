import { useState } from "react";
import { Columns3 } from "lucide-react";
import { PrInfoPopup } from "./PrInfoPopup.js";

export const ticketColumns = [
  ["type", "Тип задачи"],
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
        ...ticketColumns.filter(([key]) => key !== "synced_at"),
        ["removedAt", "Удалён"],
        ["expiresAt", "Хранится до"],
      ]
    : ticketColumns;
  const storageKey = `orbit.ticket-columns.${trash ? "trash" : "active"}`;
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
    hidden: (key: string) => hidden.includes(key),
    count: (trash ? 12 : 10) - hidden.length,
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
          ID и название тикета остаются видимыми. Настройка не меняет фильтры и
          экспорт.
        </p>
        <div className="ticket-column-options">
          {options.map(([key, label]) => (
            <label key={key}>
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
          ))}
        </div>
        <button type="button" className="secondary" onClick={() => save([])}>
          Показать все
        </button>
      </PrInfoPopup>
    ),
  };
}
