import {
  Fragment,
  Children,
  isValidElement,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { Columns3, GripVertical, X } from "lucide-react";

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
  const dialog = useRef<HTMLDialogElement>(null);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [draftHidden, setDraftHidden] = useState<string[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const finishDrag = () => {
    setDragged(null);
    setDropTarget(null);
  };
  const close = () => {
    finishDrag();
    dialog.current?.close();
  };
  const reorder = (from: string, to: string) => {
    setDraftOrder((current) => {
      if (from === to || !current.includes(from) || !current.includes(to))
        return current;
      const next = current.filter((key) => key !== from);
      next.splice(current.indexOf(to), 0, from);
      return next;
    });
  };
  return {
    order,
    hidden: (key: string) => hidden.includes(key),
    count: options.length + 3 - hidden.length,
    control: (
      <>
        <button
          type="button"
          className="secondary ticket-display-button"
          aria-haspopup="dialog"
          onClick={() => {
            setDraftOrder([...order]);
            setDraftHidden([...hidden]);
            finishDrag();
            dialog.current?.showModal();
          }}
        >
          <Columns3 size={16} />
          Отображение
        </button>
        <dialog
          ref={dialog}
          className="developer-dialog ticket-columns-dialog"
          aria-label="Отображение столбцов"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <div className="developer-dialog-heading">
            <h2>Отображение столбцов</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Закрыть"
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          <div className="ticket-columns-toolbar">
            <button
              type="button"
              className="secondary"
              onClick={() => setDraftHidden([])}
            >
              Select All
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setDraftHidden(options.map(([key]) => key))}
            >
              Deselect All
            </button>
          </div>
          <p className="muted">
            Перетащите строки за ручку слева. ID и название всегда остаются
            видимыми и идут первыми.
          </p>
          <div className="ticket-column-options">
            {draftOrder.map((key) => {
              const label = options.find(([id]) => id === key)![1];
              return (
                <div
                  key={key}
                  className={`ticket-column-option${dragged === key ? " is-dragging" : ""}${dropTarget === key ? " is-drop-target" : ""}`}
                  onDragOver={(event) => {
                    if (!dragged || dragged === key) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTarget(key);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragged) reorder(dragged, key);
                    finishDrag();
                  }}
                >
                  <button
                    type="button"
                    className="icon-button ticket-column-grip"
                    draggable
                    aria-label={`Переместить столбец: ${label}`}
                    title="Перетащите для изменения порядка. С клавиатуры: Alt + ↑ / ↓."
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", key);
                      event.dataTransfer.effectAllowed = "move";
                      setDragged(key);
                    }}
                    onDragEnd={finishDrag}
                    onKeyDown={(event) => {
                      if (
                        !event.altKey ||
                        !["ArrowUp", "ArrowDown"].includes(event.key)
                      )
                        return;
                      event.preventDefault();
                      const target =
                        draftOrder[
                          draftOrder.indexOf(key) +
                            (event.key === "ArrowUp" ? -1 : 1)
                        ];
                      if (target) reorder(key, target);
                    }}
                  >
                    <GripVertical size={17} />
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={!draftHidden.includes(key)}
                      onChange={(event) =>
                        setDraftHidden((current) =>
                          event.target.checked
                            ? current.filter((id) => id !== key)
                            : [...current, key],
                        )
                      }
                    />
                    {label}
                  </label>
                </div>
              );
            })}
          </div>
          <div className="ticket-columns-footer">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                saveOrder(draftOrder);
                save(draftHidden);
                close();
              }}
            >
              Сохранить
            </button>
          </div>
        </dialog>
      </>
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
  const flatten = (nodes: ReactNode): ReactNode[] =>
    Children.toArray(nodes).flatMap((child) =>
      isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
        ? flatten(child.props.children)
        : [child],
    );
  return <>{flatten(children).sort((a, b) => rank(a) - rank(b))}</>;
}
