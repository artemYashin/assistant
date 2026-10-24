import { NumberInput } from "./NumberInput.js";
import { useId, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Check,
  X,
} from "lucide-react";
import { wallTime } from "./calendar-time.js";

export function CalendarDateField({
  label,
  value,
  onChange,
  min,
  disabled = false,
  zone,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  disabled?: boolean;
  zone: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [month, setMonth] = useState("");
  const now = wallTime(new Date().toISOString(), zone);
  const valid =
    date &&
    /^\d{2}:\d{2}$/.test(time) &&
    Number(time.slice(0, 2)) < 24 &&
    Number(time.slice(3)) < 60 &&
    (!min || date + "T" + time >= min);
  function choose(day: string) {
    setDate(day);
    setMonth(day.slice(0, 7));
    if (min && day === min.slice(0, 10) && time < min.slice(11, 16))
      setTime(min.slice(11, 16));
  }
  function shiftMonth(delta: number) {
    const d = new Date(month + "-01T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + delta);
    setMonth(d.toISOString().slice(0, 7));
  }
  function open() {
    const initial = value || (min && min > now ? min : now);
    setDate(initial.slice(0, 10));
    setTime(initial.slice(11, 16));
    setMonth(initial.slice(0, 7));
    dialog.current?.showModal();
  }
  const first = new Date((month || now.slice(0, 7)) + "-01T12:00:00Z");
  const offset = (first.getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => {
    const d = new Date(first);
    d.setUTCDate(1 - offset + index);
    return d.toISOString().slice(0, 10);
  });
  const format = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "UTC" }).format(
      new Date(date),
    );
  return (
    <div className="calendar-date-field">
      <span id={id} className="calendar-date-label">
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className={"calendar-date-trigger" + (value ? " has-value" : "")}
        aria-label={`Выбрать дату: ${label}`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={open}
      >
        <CalendarDays size={18} />
        <span>
          {value
            ? format(value + ":00Z", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "Выбрать дату и время"}
        </span>
      </button>
      {value && (
        <button
          type="button"
          className="calendar-date-clear"
          disabled={disabled}
          aria-label={`Очистить дату: ${label}`}
          onClick={() => onChange("")}
        >
          <X size={12} />
          Сбросить
        </button>
      )}
      <dialog
        ref={dialog}
        className="calendar-date-picker"
        aria-label={`Выбор даты: ${label}`}
        onCancel={(e) => e.stopPropagation()}
        onClose={() => trigger.current?.focus()}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            dialog.current?.close();
        }}
      >
        <div className="calendar-picker-title">
          <span>
            <CalendarDays size={18} />
            {label}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть выбор даты"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <div className="calendar-picker-month">
          <button
            type="button"
            className="icon-button"
            aria-label="Предыдущий месяц"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <strong aria-live="polite">
            {format(first.toISOString(), { month: "long", year: "numeric" })}
          </strong>
          <button
            type="button"
            className="icon-button"
            aria-label="Следующий месяц"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="calendar-picker-days">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
            <span className="calendar-picker-weekday" key={day}>
              {day}
            </span>
          ))}
          {days.map((day) => (
            <button
              type="button"
              key={day}
              data-day={day}
              className={`calendar-picker-day ${day.slice(0, 7) !== month ? "outside" : ""} ${day === now.slice(0, 10) ? "today" : ""} ${day === date ? "selected" : ""}`}
              aria-label={format(day + "T12:00Z", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              aria-pressed={day === date}
              disabled={!!min && day < min.slice(0, 10)}
              onClick={() => choose(day)}
              onKeyDown={(e) => {
                const delta = (
                  {
                    ArrowLeft: -1,
                    ArrowRight: 1,
                    ArrowUp: -7,
                    ArrowDown: 7,
                  } as Record<string, number>
                )[e.key];
                if (!delta) return;
                e.preventDefault();
                const next = new Date(day + "T12:00Z");
                next.setUTCDate(next.getUTCDate() + delta);
                const nextDay = next.toISOString().slice(0, 10);
                if (min && nextDay < min.slice(0, 10)) return;
                choose(nextDay);
                requestAnimationFrame(() =>
                  dialog.current
                    ?.querySelector<HTMLButtonElement>(
                      `[data-day="${nextDay}"]`,
                    )
                    ?.focus(),
                );
              }}
            >
              {Number(day.slice(-2))}
            </button>
          ))}
        </div>
        <div className="calendar-picker-time">
          <span>
            <Clock size={16} />
            Время
          </span>
          <div>
            <NumberInput
              aria-label="Часы"
              min={0}
              max={23}
              value={time.slice(0, 2)}
              onChange={(e) =>
                setTime(e.target.value.padStart(2, "0") + ":" + time.slice(3))
              }
            />
            <b>:</b>
            <NumberInput
              aria-label="Минуты"
              min={0}
              max={59}
              value={time.slice(3)}
              onChange={(e) =>
                setTime(
                  time.slice(0, 2) + ":" + e.target.value.padStart(2, "0"),
                )
              }
            />
          </div>
        </div>
        <div className="calendar-picker-shortcuts">
          <button
            type="button"
            className="secondary"
            disabled={!!min && now.slice(0, 10) < min.slice(0, 10)}
            onClick={() => choose(now.slice(0, 10))}
          >
            Сегодня
          </button>
          <span>{zone}</span>
        </div>
        {!valid && (
          <p className="error" role="alert">
            Укажите корректное время, не раньше начала.
          </p>
        )}
        <div className="calendar-picker-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => dialog.current?.close()}
          >
            Отмена
          </button>
          <button
            type="button"
            className="primary"
            disabled={!valid}
            onClick={() => {
              onChange(date + "T" + time);
              dialog.current?.close();
            }}
          >
            <Check size={16} />
            Выбрать
          </button>
        </div>
      </dialog>
    </div>
  );
}
