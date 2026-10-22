import type { TicketExportContext } from "../server/ticket-export-context.js";
import { useDragAutoScroll } from "./useDragAutoScroll.js";
import { StatusBadge } from "./TicketControls.js";
import {
  exportColumns,
  defaultExportColumns,
  type ExportColumnKey,
} from "./ticket-export-columns.js";
import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  X,
  Plus,
  Search,
  Ticket,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Minimize2,
  Maximize2,
} from "lucide-react";
import { ticketsCsv, type CsvTicket } from "./tickets-csv.js";
import { api } from "./api.js";

let exportContext: TicketExportContext = {
  state: "closed",
  ids: [],
  total: 0,
  columns: [...defaultExportColumns],
  format: "xlsx",
};
export function currentTicketExport(): TicketExportContext | undefined {
  return exportContext.state === "closed" ? undefined : structuredClone(exportContext);
}
let exportIsMinimized = false;
const minimizedEvent = "orbit:export-minimized";
const eventName = "orbit:export-tickets";
/** Open the shared export composer with ticket snapshots or local ticket IDs. */
export function openTicketExport(
  tickets: (CsvTicket | number)[],
  columns?: ExportColumnKey[],
) {
  window.dispatchEvent(
    new CustomEvent(eventName, { detail: { tickets, mode: "open", columns } }),
  );
}
/** Append to an existing export without reopening it when minimized. */
export function addTicketsToExport(
  tickets: (CsvTicket | number)[],
  columns?: ExportColumnKey[],
) {
  window.dispatchEvent(
    new CustomEvent(eventName, { detail: { tickets, mode: "add", columns } }),
  );
}
export function ExportTickets({
  tickets,
  trash = false,
}: {
  tickets: CsvTicket[];
  trash?: boolean;
}) {
  const [minimized, setMinimized] = useState(exportIsMinimized);
  useEffect(() => {
    const update = () => setMinimized(exportIsMinimized);
    window.addEventListener(minimizedEvent, update);
    update();
    return () => window.removeEventListener(minimizedEvent, update);
  }, []);
  return (
    <div className="ticket-export-actions">
      <button
        type="button"
        className="secondary"
        onClick={() =>
          openTicketExport(
            trash
              ? tickets.map((ticket) => ({ ...ticket, inTrash: true }))
              : tickets,
          )
        }
      >
        <FileSpreadsheet size={16} />
        Экспорт{tickets.length ? ` (${tickets.length})` : ""}
      </button>
      {minimized && (
        <button
          type="button"
          className="secondary export-append-button"
          disabled={!tickets.length}
          onClick={() =>
            addTicketsToExport(
              trash
                ? tickets.map((ticket) => ({ ...ticket, inTrash: true }))
                : tickets,
            )
          }
        >
          <Plus size={16} />
          Добавить в экспорт
        </button>
      )}
    </div>
  );
}
export function TicketExportDialog({
  settings,
}: {
  settings?: {
    typeColors?: Record<string, string>;
    statusColors?: Record<string, string>;
  };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState(false);
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    exportIsMinimized = minimized;
    window.dispatchEvent(new Event(minimizedEvent));
    return () => {
      exportIsMinimized = false;
      window.dispatchEvent(new Event(minimizedEvent));
    };
  }, [minimized]);
  const autoScroll = useDragAutoScroll();
  const draftActive = useRef(false),
    minimizedRef = useRef(false);
  const draftTickets = useRef<(CsvTicket | number)[]>([]);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<CsvTicket[]>([]);
  const [snapshot, updateSnapshot] = useState<CsvTicket[]>([]);
  const snapshotRef = useRef<CsvTicket[]>([]);
  const setSnapshot = (
    value: CsvTicket[] | ((current: CsvTicket[]) => CsvTicket[]),
  ) => {
    const rows =
      typeof value === "function" ? value(snapshotRef.current) : value;
    snapshotRef.current = rows;
    updateSnapshot(rows);
    draftTickets.current = rows;
  };
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const [order, setOrder] = useState<ExportColumnKey[]>(
    exportColumns.map((c) => c.key),
  );
  const [enabled, setEnabled] =
    useState<ExportColumnKey[]>(defaultExportColumns);
  const [adding, setAdding] = useState(false),
    [query, setQuery] = useState("");
  const [dragged, setDragged] = useState<ExportColumnKey | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    key: ExportColumnKey;
    edge: "before" | "after";
  } | null>(null);
  const lock = useRef(false),
    request = useRef<AbortController | null>(null);
  const columns = order.filter((key) => enabled.includes(key));
  useEffect(() => {
    exportContext = {
      state: !active ? "closed" : minimized ? "minimized" : "open",
      ids: active ? snapshot.map((t) => t.id) : [],
      total: active ? snapshot.length : 0,
      columns,
      format,
    };
  }, [active, minimized, snapshot, order, enabled, format]);
  useEffect(
    () => () => {
      exportContext = {
        state: "closed",
        ids: [],
        total: 0,
        columns: [...defaultExportColumns],
        format: "xlsx",
      };
    },
    [],
  );
  const trash =
    snapshot.length > 0 && snapshot.every((ticket) => ticket.inTrash);
  useEffect(() => {
    const open = (event: Event) => {
      if (lock.current) return;
      const {
        tickets,
        mode,
        columns: requestedColumns,
      } = (
        event as CustomEvent<{
          tickets: (CsvTicket | number)[];
          mode: "open" | "add";
          columns?: ExportColumnKey[];
        }>
      ).detail || {};
      if (!Array.isArray(tickets)) return;
      if (requestedColumns) {
        const selected = [...new Set(requestedColumns)].filter((key) =>
          exportColumns.some((column) => column.key === key),
        );
        if (selected.length) {
          setEnabled(selected);
          setOrder((previous) => [
            ...selected,
            ...previous.filter((key) => !selected.includes(key)),
          ]);
        }
      }
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const initial = [
        ...new Map(
          [
            ...(draftActive.current ? draftTickets.current : []),
            ...tickets,
          ].map((ticket) => [
            typeof ticket === "number" ? ticket : ticket.id,
            ticket,
          ]),
        ).values(),
      ];
      setSnapshot(
        initial.map((ticket) =>
          typeof ticket === "number" ? { id: ticket } : structuredClone(ticket),
        ),
      );
      draftTickets.current = initial;
      draftActive.current = true;
      setActive(true);
      setError("");
      setQuery("");
      setAdding(false);
      setCatalog([]);
      setLoading(true);
      if (mode !== "add" || !minimizedRef.current) {
        minimizedRef.current = false;
        setMinimized(false);
        if (!dialog.current?.open) dialog.current?.showModal();
      }
      Promise.all([
        api<CsvTicket[]>("/tickets", "GET", undefined, controller.signal),
        api<CsvTicket[]>("/tickets/trash", "GET", undefined, controller.signal),
      ])
        .then(([active, removed]) => {
          if (controller.signal.aborted) return;
          const all = [
            ...active,
            ...removed.map((t) => ({ ...t, inTrash: true })),
          ];
          setCatalog(all);
          const missing: number[] = [];
          const resolved = initial.flatMap((ticket) => {
            if (typeof ticket !== "number") return [structuredClone(ticket)];
            const found = all.find((t) => t.id === ticket);
            if (!found) {
              missing.push(ticket);
              return [];
            }
            return [found];
          });
          setSnapshot(resolved);
          if (missing.length)
            setError(
              `Не найдены локально: ${missing.join(", ")}. Эти тикеты не добавлены в экспорт.`,
            );
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(`Не удалось загрузить список тикетов: ${e.message}`);
            setSnapshot(
              initial.filter((t): t is CsvTicket => typeof t !== "number"),
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    window.addEventListener(eventName, open);
    return () => {
      window.removeEventListener(eventName, open);
      request.current?.abort();
    };
  }, []);
  const close = () => {
    if (busy) return;
    request.current?.abort();
    setLoading(false);
    autoScroll.stop();
    dialog.current?.close();
    draftActive.current = false;
    setActive(false);
    minimizedRef.current = false;
    setMinimized(false);
    setSnapshot([]);
    setError("");
    setAdding(false);
  };
  const minimize = () => {
    autoScroll.stop();
    dialog.current?.close();
    minimizedRef.current = true;
    setMinimized(true);
    setAdding(false);
  };
  const expand = () => {
    minimizedRef.current = false;
    setMinimized(false);
    dialog.current?.showModal();
  };
  const move = (from: ExportColumnKey, to: ExportColumnKey) =>
    setOrder((current) => {
      const next = [...current];
      const old = next.indexOf(from),
        target = next.indexOf(to);
      next.splice(old, 1);
      next.splice(target, 0, from);
      return next;
    });
  const search = query.trim().toLocaleLowerCase().replace(/^#/, "");
  const results = catalog
    .filter(
      (t) =>
        !snapshot.some((selected) => selected.id === t.id) &&
        (!search ||
          String(t.id).includes(search) ||
          t.title?.toLocaleLowerCase().includes(search)),
    )
    .slice(0, 20);
  async function download() {
    if (lock.current || !columns.length || !snapshot.length || loading) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const blob =
        format === "csv"
          ? new Blob([ticketsCsv(snapshot, columns)], {
              type: "text/csv;charset=utf-8",
            })
          : new Blob(
              [
                await (
                  await import("./tickets-xlsx.js")
                ).ticketsXlsx(snapshot, trash, columns),
              ],
              {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              },
            );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const date = new Date();
      const stamp = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");
      anchor.href = url;
      anchor.download = `orbit-tickets${trash ? "-trash" : ""}-${stamp}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      dialog.current?.close();
      draftActive.current = false;
      setActive(false);
      minimizedRef.current = false;
      setMinimized(false);
      setSnapshot([]);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError("Не удалось создать файл. Попробуйте экспортировать ещё раз.");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <>
      {minimized && (
        <aside className="export-minimized" aria-label="Свёрнутый экспорт">
          <FileSpreadsheet size={18} />
          <span>
            Экспорт · {snapshot.length} тикетов{loading ? " · загрузка…" : ""}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Развернуть экспорт"
            onClick={expand}
          >
            <Maximize2 size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть экспорт"
            disabled={busy}
            onClick={close}
          >
            <X size={16} />
          </button>
        </aside>
      )}
      <dialog
        ref={dialog}
        className="developer-dialog ticket-export-dialog"
        aria-label="Экспорт тикетов"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <div className="developer-dialog-heading">
          <h2>
            <FileSpreadsheet size={21} />
            Экспорт тикетов
          </h2>
          <button
            type="button"
            className="icon-button export-minimize"
            aria-label="Свернуть экспорт"
            onClick={minimize}
          >
            <Minimize2 size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть экспорт"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <div
          className="export-format"
          role="group"
          aria-label="Формат экспорта"
        >
          <span>Формат</span>
          {(
            [
              ["xlsx", "Excel"],
              ["csv", "CSV"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={format === value}
              disabled={busy}
              onClick={() => setFormat(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="export-workspace">
          <section className="export-ticket-panel">
            <h3>
              Тикеты <span>{snapshot.length}</span>
            </h3>
            <div
              className="export-ticket-list"
              aria-label="Тикеты для экспорта"
            >
              {!snapshot.length && (
                <p className="muted">Добавьте тикеты с помощью кнопки ниже.</p>
              )}
              {snapshot.map((ticket) => (
                <div className="export-ticket-row" key={ticket.id}>
                  <Ticket size={18} />
                  <div>
                    <strong>#{ticket.id}</strong>
                    <span className="export-ticket-title">
                      {ticket.title || "Загрузка…"}
                    </span>
                    <div className="export-ticket-meta">
                      <StatusBadge
                        state={ticket.type || "Тип не указан"}
                        kind="type"
                        colors={settings?.typeColors}
                      />
                      <StatusBadge
                        state={ticket.state || "Не указан"}
                        colors={settings?.statusColors}
                      />
                      {ticket.inTrash && <span>В корзине</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Убрать из экспорта #${ticket.id}`}
                    disabled={busy || loading}
                    onClick={() =>
                      setSnapshot((rows) =>
                        rows.filter((t) => t.id !== ticket.id),
                      )
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div
              className="export-ticket-add"
              onKeyDown={(event) => {
                if (event.key === "Escape" && adding) {
                  event.preventDefault();
                  event.stopPropagation();
                  setAdding(false);
                  setQuery("");
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      ".export-ticket-results > button",
                    ),
                  ];
                  if (!buttons.length) return;
                  event.preventDefault();
                  const index = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  buttons[
                    (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                      buttons.length
                  ]?.focus();
                }
              }}
            >
              {adding ? (
                <>
                  <div className="export-ticket-search">
                    <Search size={16} />
                    <input
                      autoFocus
                      value={query}
                      disabled={loading || busy}
                      placeholder="Номер или название тикета"
                      aria-label="Найти тикет для экспорта"
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Отменить добавление"
                      onClick={() => {
                        setAdding(false);
                        setQuery("");
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {!!query.trim() && (
                    <div
                      className="export-ticket-results"
                      aria-label="Найденные тикеты"
                    >
                      {results.map((ticket) => (
                        <button
                          type="button"
                          key={ticket.id}
                          disabled={busy || loading}
                          onClick={() => {
                            setSnapshot((rows) =>
                              rows.some((t) => t.id === ticket.id)
                                ? rows
                                : [...rows, ticket],
                            );
                            setQuery("");
                            setAdding(false);
                          }}
                        >
                          <Ticket size={15} />
                          <span>
                            <strong>#{ticket.id}</strong> {ticket.title}
                            <small>
                              {ticket.type} · {ticket.state}
                              {ticket.inTrash ? " · В корзине" : ""}
                            </small>
                          </span>
                          <Plus size={15} />
                        </button>
                      ))}
                      {!results.length && (
                        <p className="muted">
                          {loading
                            ? "Загрузка…"
                            : "Нет подходящих локальных тикетов"}
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || loading}
                  onClick={() => setAdding(true)}
                >
                  <Plus size={16} />
                  Добавить тикет
                </button>
              )}
            </div>
          </section>
          <section className="export-fields-panel">
            <h3>Столбцы</h3>
            <p className="muted">Перетащите строки, чтобы изменить порядок.</p>
            <div className="export-fields-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEnabled([...order])}
              >
                Выбрать все
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEnabled([])}
              >
                Снять выбор
              </button>
            </div>
            <div
              className="export-fields-list"
              onDragOver={(event) =>
                autoScroll.onDragOver(event, !!dragged && !busy)
              }
              onDragLeave={autoScroll.onDragLeave}
            >
              {order.map((key, index) => {
                const column = exportColumns.find((c) => c.key === key)!;
                return (
                  <div
                    key={key}
                    className={`export-field${enabled.includes(key) ? " is-enabled" : ""}${dropTarget?.key === key ? ` is-drop-${dropTarget.edge}` : ""}`}
                    draggable={!busy}
                    onDragStart={(e) => {
                      setDragged(key);
                      e.dataTransfer.setData("text/plain", key);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (!busy && dragged) {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setDropTarget(
                          dragged === key
                            ? null
                            : {
                                key,
                                edge:
                                  e.clientY < rect.top + rect.height / 2
                                    ? "before"
                                    : "after",
                              },
                        );
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!busy && dragged && dragged !== key) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const after = e.clientY >= rect.top + rect.height / 2;
                        setOrder((current) => {
                          const next = current.filter(
                            (item) => item !== dragged,
                          );
                          next.splice(
                            next.indexOf(key) + (after ? 1 : 0),
                            0,
                            dragged,
                          );
                          return next;
                        });
                      }
                      autoScroll.stop();
                      setDragged(null);
                      setDropTarget(null);
                    }}
                    onDragEnd={() => {
                      autoScroll.stop();
                      setDragged(null);
                      setDropTarget(null);
                    }}
                  >
                    <GripVertical size={16} />
                    <label>
                      <input
                        type="checkbox"
                        checked={enabled.includes(key)}
                        disabled={busy}
                        onChange={(e) =>
                          setEnabled((current) =>
                            e.target.checked
                              ? [...current, key]
                              : current.filter((k) => k !== key),
                          )
                        }
                      />
                      <span>
                        {column.label}
                        <small>{column.header}</small>
                      </span>
                    </label>
                    <div>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Выше: ${column.label}`}
                        disabled={busy || index === 0}
                        onClick={() => move(key, order[index - 1])}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Ниже: ${column.label}`}
                        disabled={busy || index === order.length - 1}
                        onClick={() => move(key, order[index + 1])}
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
        {loading && <p role="status">Загружаю локальные тикеты…</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="export-footer">
          <small>
            Заголовки файла — на английском, значения — без перевода.
          </small>
          <button
            type="button"
            className="primary"
            disabled={busy || loading || !columns.length || !snapshot.length}
            onClick={() => void download()}
          >
            <Download size={16} />
            {busy
              ? "Подготовка…"
              : `Скачать ${format === "xlsx" ? "Excel" : "CSV"}`}
          </button>
        </footer>
      </dialog>
    </>
  );
}
