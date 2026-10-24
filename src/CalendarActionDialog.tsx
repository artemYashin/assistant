import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import type { CalendarStatusRequest } from "../server/chat-stream.js";
import type { CalendarItem } from "../server/calendar-model.js";
import { api } from "./api.js";

export function CalendarActionDialog({
  request,
  onClose,
}: {
  request: CalendarStatusRequest;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [item, setItem] = useState<CalendarItem | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    ref.current?.showModal();
    api("/calendar")
      .then((data) => {
        if (!active) return;
        const found = data.items.find((i: CalendarItem) => i.id === request.id);
        if (!found) throw new Error("Напоминание не найдено.");
        if (!!found.repeatDaily !== (request.target !== "reminder"))
          throw new Error(
            "Тип напоминания изменился. Повторите запрос ассистенту.",
          );
        setItem(found);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [request]);
  const label =
    request.target === "today"
      ? request.completed
        ? request.day
          ? "Завершить итерацию"
          : "Завершить сегодня"
        : request.day
          ? "Возобновить итерацию"
          : "Возобновить сегодня"
      : request.target === "series"
        ? request.completed
          ? "Завершить всю серию"
          : "Возобновить всю серию"
        : request.completed
          ? "Завершить напоминание"
          : "Вернуть в незавершённые";
  return (
    <dialog
      ref={ref}
      className="developer-dialog action-confirm-dialog"
      aria-label={label}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClose={onClose}
    >
      <div className="developer-dialog-heading">
        <h2>{label}?</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть"
          disabled={busy}
          onClick={() => ref.current?.close()}
        >
          <X size={18} />
        </button>
      </div>
      <p>{item?.title || (error ? "" : "Загружаю напоминание…")}</p>
      <p className="muted">
        {request.target === "series"
          ? "Действие относится ко всей ежедневной серии."
          : request.target === "today"
            ? `Изменится только итерация ${request.day || "за сегодня"} в часовом поясе серии; остальные дни сохранятся.`
            : "Изменится отметка завершения напоминания."}{" "}
        {request.completed
          ? "Завершённые напоминания перестают уведомлять."
          : "Уведомления возобновятся в следующей общей подборке с учётом срока и расписания."}
        {request.target === "series" &&
          !request.completed &&
          " Отметки завершения отдельных дней сохранятся."}
        {item?.ticket &&
          " Статус тикета в Azure и локальный дедлайн не изменятся."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="secondary"
          autoFocus
          disabled={busy}
          onClick={() => ref.current?.close()}
        >
          Отмена
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !item}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const endpoint = request.completed ? "complete" : "reopen";
              await api(
                "/calendar/" +
                  encodeURIComponent(request.id) +
                  "/" +
                  endpoint +
                  (request.target === "today" ? "-today" : ""),
                "POST",
                { day: request.day },
              );
              window.dispatchEvent(new Event("orbit-calendar-changed"));
              ref.current?.close();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {request.completed ? <Check size={16} /> : <RotateCcw size={16} />}
          {busy ? "Сохраняю…" : label}
        </button>
      </div>
    </dialog>
  );
}
