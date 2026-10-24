import { useRef } from "react";
import { CalendarDays, X } from "lucide-react";
export function CalendarDateField({
  label,
  value,
  onChange,
  min,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="calendar-date-field">
      <label>
        <span>{label}</span>
        <span className="calendar-date-control">
          <input
            ref={input}
            aria-label={label}
            type="datetime-local"
            value={value}
            min={min}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            className="calendar-picker-button"
            aria-label={`Выбрать дату: ${label}`}
            disabled={disabled}
            onClick={() => {
              try {
                input.current?.showPicker();
              } catch {
                input.current?.focus();
              }
            }}
          >
            <CalendarDays size={20} />
          </button>
        </span>
      </label>
      {value && (
        <button
          type="button"
          className="calendar-date-clear"
          aria-label={`Очистить дату: ${label}`}
          onClick={() => onChange("")}
        >
          <X size={12} />
          Сбросить
        </button>
      )}
    </div>
  );
}
