import { SingleSelect } from "./SingleSelect.js";

export function SyncScheduleSettings({
  value,
  onChange,
  notifications = false,
}: {
  value: any;
  notifications?: boolean;
  onChange: (value: any) => void;
}) {
  const set = (key: string, next: any) => onChange({ ...value, [key]: next });
  return (
    <div className="sync-schedule-settings">
      <SingleSelect
        label={
          notifications ? "Режим уведомлений" : "Автоматическая синхронизация"
        }
        value={value.mode}
        onChange={(mode) => set("mode", mode)}
        options={[
          {
            value: "always",
            label: notifications ? "В любое время" : "Обновлять всегда",
          },
          { value: "scheduled", label: "По расписанию" },
        ]}
      />
      {value.mode === "scheduled" && (
        <>
          <div className="sync-time-range">
            <label>
              {notifications ? "Показывать с" : "Обновлять с"}
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
          </div>
          <div
            className="sync-weekdays"
            role="group"
            aria-label={notifications ? "Дни уведомлений" : "Дни синхронизации"}
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
            {notifications
              ? "Вне расписания всплывающие уведомления не показываются; список в хедере остаётся доступен. "
              : "Вне выбранного времени фоновые обновления приостановлены. Ручное обновление доступно всегда. "}
            Одинаковое время — весь день; ночной интервал относится к дню
            начала. Без выбранных дней расписание выключено.
          </small>
        </>
      )}
    </div>
  );
}
