import { useState } from "react";
import { Bell, CalendarDays } from "lucide-react";
import { SyncScheduleSettings } from "./SyncScheduleSettings.js";
export function CalendarSettings({
  form,
  set,
}: {
  form: any;
  set: (key: string, value: any) => void;
}) {
  const [permission, setPermission] = useState(
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const [error, setError] = useState("");
  const options = form.calendarNotifications;
  function update(key: string, value: any) {
    set("calendarNotifications", { ...options, [key]: value });
  }
  return (
    <>
      <h2>
        <CalendarDays size={20} /> Календарь
      </h2>
      <label>
        Часовой пояс
        <input
          value={form.syncSchedule.timeZone}
          onChange={(e) =>
            set("syncSchedule", {
              ...form.syncSchedule,
              timeZone: e.target.value,
            })
          }
          placeholder="Asia/Bishkek"
          list="calendar-timezones"
        />
      </label>
      <datalist id="calendar-timezones">
        {[
          "UTC",
          "Asia/Bishkek",
          "Europe/Moscow",
          "Europe/Berlin",
          "Asia/Almaty",
          "America/New_York",
        ].map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <p className="muted">
        Общий часовой пояс календаря, напоминаний и расписания автообновлений.
        Уже созданные события сохраняют свой момент времени.
      </p>
      <label className="calendar-check">
        <input
          type="checkbox"
          checked={options.browser}
          onChange={(e) => update("browser", e.target.checked)}
        />
        <span>Присылать уведомления из браузера</span>
      </label>
      <button
        type="button"
        className="secondary"
        disabled={permission === "unsupported" || permission === "granted"}
        onClick={async () => {
          try {
            setPermission(await Notification.requestPermission());
          } catch {
            setError(
              "Браузер не разрешил запрос уведомлений. Проверьте настройки сайта и HTTPS.",
            );
          }
        }}
      >
        <Bell size={16} />
        {permission === "granted"
          ? "Разрешение получено"
          : "Разрешить уведомления"}
      </button>
      <p className="muted">
        {permission === "denied"
          ? "Уведомления заблокированы. Разрешите их в настройках сайта браузера."
          : permission === "unsupported"
            ? "Этот браузер не поддерживает системные уведомления."
            : "Системные уведомления требуют разрешения браузера и HTTPS (или localhost). Orbit должен оставаться открытым; при закрытом браузере доставка не выполняется."}
      </p>
      {error && <p className="error">{error}</p>}
      <fieldset
        className="calendar-notification-settings"
        disabled={!options.browser}
      >
        <legend>Повторные уведомления</legend>
        <label>
          Интервал, минуты
          <input
            type="number"
            min={1}
            max={10080}
            value={options.intervalMinutes}
            onChange={(e) => update("intervalMinutes", Number(e.target.value))}
          />
        </label>
        <SyncScheduleSettings
          notifications
          value={options.schedule}
          onChange={(value) => update("schedule", value)}
        />
      </fieldset>
      <p className="muted">
        Расписание и частота регулируют всплывающие напоминания. Внутри
        приложения они доступны и без разрешения браузера. В хедере активные
        напоминания видны постоянно. Закрытие алерта не завершает напоминание.
      </p>
    </>
  );
}
