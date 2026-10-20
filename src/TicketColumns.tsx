import { useTicketColumnResize } from "./useTicketColumnResize.js";
import {
  Fragment,
  cloneElement,
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
  const resize = useTicketColumnResize(storageKey + ".widths", [
    "selection",
    "id",
    "title",
    ...order.filter((key) => !hidden.includes(key)),
  ]);
  const [resetWidths, setResetWidths] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [draftHidden, setDraftHidden] = useState<string[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    key: string;
    edge: "before" | "after";
  } | null>(null);
  const finishDrag = () => {
    setDragged(null);
    setDropTarget(null);
  };
  const close = () => {
    finishDrag();
    dialog.current?.close();
  };
  const reorder = (from: string, to: string, edge: "before" | "after") => {
    setDraftOrder((current) => {
      if (from === to || !current.includes(from) || !current.includes(to))
        return current;
      const next = current.filter((key) => key !== from);
      next.splice(next.indexOf(to) + (edge === "after" ? 1 : 0), 0, from);
      return next;
    });
  };
  return {
    resize,
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
            setResetWidths(false);
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
                  className={`ticket-column-option${dragged === key ? " is-dragging" : ""}${dropTarget?.key === key ? ` is-drop-${dropTarget.edge}` : ""}`}
                  onDragOver={(event) => {
                    if (!dragged || dragged === key) {
                      setDropTarget(null);
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const rect = event.currentTarget.getBoundingClientRect();
                    setDropTarget({
                      key,
                      edge:
                        event.clientY < rect.top + rect.height / 2
                          ? "before"
                          : "after",
                    });
                  }}
                  onDragLeave={(event) => {
                    if (
                      !(event.relatedTarget instanceof Node) ||
                      !event.currentTarget.contains(event.relatedTarget)
                    ) {
                      setDropTarget((current) =>
                        current?.key === key ? null : current,
                      );
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    if (dragged)
                      reorder(
                        dragged,
                        key,
                        event.clientY < rect.top + rect.height / 2
                          ? "before"
                          : "after",
                      );
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
                      if (target)
                        reorder(
                          key,
                          target,
                          event.key === "ArrowUp" ? "before" : "after",
                        );
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
          <button
            type="button"
            className="text-button"
            disabled={!resize.manual || resetWidths}
            onClick={() => setResetWidths(true)}
          >
            {resetWidths
              ? "Ширины будут сброшены при сохранении"
              : "Сбросить ширины"}
          </button>
          <div className="ticket-columns-footer">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (resetWidths) resize.reset();
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
  headerResize,
}: {
  children: ReactNode;
  order: string[];
  headerResize?: (key: string, label: string) => ReactNode;
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
  return (
    <>
      {flatten(children)
        .sort((a, b) => rank(a) - rank(b))
        .map((child) => {
          if (
            !headerResize ||
            !isValidElement<{
              "data-column"?: string;
              "data-resize-key"?: string;
              className?: string;
              children?: ReactNode;
              hidden?: boolean;
            }>(child) ||
            child.type !== "th"
          )
            return child;
          const props = child.props;
          const key =
            props["data-column"] ||
            (props.className?.includes("ticket-selection-column")
              ? "selection"
              : props.className?.includes("ticket-identity-column")
                ? "id"
                : "title");
          const label =
            ticketColumns.find(([id]) => id === key)?.[1] ||
            (
              {
                id: "ID и тип",
                title: "Тикет",
                removedAt: "Удалён",
                expiresAt: "Хранится до",
              } as Record<string, string>
            )[key] ||
            key;
          return cloneElement(
            child,
            {
              "data-resize-key": key,
              className: (props.className || "") + " ticket-resizable-heading",
            },
            props.children,
            !props.hidden && headerResize(key, label),
          );
        })}
    </>
  );
}
