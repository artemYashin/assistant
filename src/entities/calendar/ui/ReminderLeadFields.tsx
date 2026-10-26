import { NumberInput } from "../../../shared/ui/number-input/index.js";
export function ReminderLeadFields({
  value,
  fallback,
  onChange,
}: {
  value: number | null;
  fallback: number;
  onChange: (value: number | null) => void;
}) {
  const total = value ?? fallback;
  const parts = [
    Math.floor(total / 1440),
    Math.floor((total % 1440) / 60),
    total % 60,
  ];
  return (
    <fieldset className="calendar-lead-settings">
      <legend>Предупреждать заранее</legend>
      <label className="calendar-check">
        <input
          type="checkbox"
          checked={value === null}
          onChange={(e) => onChange(e.target.checked ? null : fallback)}
        />
        <span>Использовать общую настройку</span>
      </label>
      <div className="calendar-lead-fields">
        {["Дней", "Часов", "Минут"].map((label, index) => (
          <label key={label}>
            {label}
            <NumberInput
              min={0}
              max={index === 0 ? 365 : index === 1 ? 23 : 59}
              step={1}
              disabled={value === null}
              value={parts[index]}
              onChange={(e) => {
                const next = [...parts];
                next[index] = Math.max(
                  0,
                  Math.min(
                    index === 0 ? 365 : index === 1 ? 23 : 59,
                    Math.trunc(Number(e.target.value)),
                  ),
                );
                onChange(
                  Math.min(525600, next[0] * 1440 + next[1] * 60 + next[2]),
                );
              }}
            />
          </label>
        ))}
      </div>
      <p className="muted">
        Нули — уведомлять с момента начала. Для напоминания без даты интервал не
        применяется.
      </p>
    </fieldset>
  );
}
