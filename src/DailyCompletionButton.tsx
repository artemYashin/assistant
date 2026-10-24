import { Check, RotateCcw } from "lucide-react";
import { ConfirmButton } from "./ConfirmButton.js";
import { api } from "./api.js";
import { dailyOccurrence } from "../server/calendar-repeat.js";
import { wallTime } from "./calendar-time.js";
import type { CalendarItem } from "../server/calendar-model.js";

export function DailyCompletionButton({
  item,
  onChange,
  compact = false,
}: {
  item: CalendarItem;
  onChange?: () => unknown;
  compact?: boolean;
}) {
  const today = wallTime(
    new Date().toISOString(),
    item.repeatZone || "UTC",
  ).slice(0, 10);
  const day = item.occurrenceDay || today;
  if (!item.repeatDaily || item.completed || !dailyOccurrence(item, day))
    return null;
  const done = !!item.completedDays?.includes(day),
    label =
      day === today
        ? done
          ? "Возобновить сегодня"
          : "Завершить сегодня"
        : done
          ? "Возобновить итерацию"
          : "Завершить итерацию";
  return (
    <ConfirmButton
      className={compact ? "icon-button calendar-toast-complete" : "secondary"}
      ariaLabel={`${label}: ${item.title}`}
      title={label + "?"}
      message={`«${item.title}» · ${day}. ${done ? "Уведомления за выбранную дату снова будут приходить по расписанию." : "Уведомления за выбранную дату прекратятся. Остальные итерации сохранятся."}`}
      confirmLabel={label}
      onConfirm={async () => {
        await api(
          `/calendar/${item.id}/${done ? "reopen-today" : "complete-today"}`,
          "POST",
          { day },
        );
        window.dispatchEvent(new Event("orbit-calendar-changed"));
        await onChange?.();
      }}
    >
      {done ? <RotateCcw size={16} /> : <Check size={16} />} {!compact && label}
    </ConfirmButton>
  );
}
