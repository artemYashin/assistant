import { SingleSelect } from "./SingleSelect.js";

export function SyncScheduleSettings({
  value,
  onChange,
}: {
  value: any;
  onChange: (value: any) => void;
}) {
  const set = (key: string, next: any) => onChange({ ...value, [key]: next });
  return (
    <div className="sync-schedule-settings">
      <SingleSelect
        label="Автоматическая синхронизация"
        value={value.mode}
        onChange={(mode) =>
          onChange({
            ...value,
            mode,
            timeZone:
              value.mode === "always"
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : value.timeZone,
          })
        }
        options={[
          { value: "always", label: "Обновлять всегда" },
          { value: "scheduled", label: "По расписанию" },
        ]}
      />
      {value.mode === "scheduled" && (
        <>
          <div className="sync-time-range">
            <label>
              Обновлять с
              <input
                type="time"
                required
                value={value.start}
                onChange={(e) => set("start", e.target.value)}
              />
            </label>
            <label>
              До
              <input
                type="time"
                required
                value={value.end}
                onChange={(e) => set("end", e.target.value)}
              />
            </label>
            <label>
              Часовой пояс
              <input
                value={value.timeZone}
                onChange={(e) => set("timeZone", e.target.value)}
                placeholder="Asia/Bishkek"
              />
            </label>
          </div>
          <div
            className="sync-weekdays"
            role="group"
            aria-label="Дни синхронизации"
          >
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((name, index) => (
              <button
                type="button"
                key={name}
                aria-pressed={value.days.includes(index + 1)}
                onClick={() =>
                  set(
                    "days",
                    value.days.includes(index + 1)
                      ? value.days.filter((day: number) => day !== index + 1)
                      : [...value.days, index + 1].sort(),
                  )
                }
              >
                {name}
              </button>
            ))}
          </div>
          <small className="muted">
            Вне выбранного времени фоновые обновления приостановлены. Ручное
            обновление доступно всегда. Одинаковое время — весь день; ночной
            интервал относится к дню начала. Без выбранных дней автообновление
            выключено.
          </small>
        </>
      )}
    </div>
  );
}
