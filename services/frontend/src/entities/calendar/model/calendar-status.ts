import { calendarStatus } from "../../../../../backend/src/calendar-model.js";

export const statusLabels: Record<string, string> = {
  recurring: "Повторяется",
  today_completed: "Сегодня завершено",
  open: "Без срока",
  upcoming: "Предстоит",
  ongoing: "Идёт сейчас",
  overdue: "Просрочено",
  completed: "Завершено",
};
export function calendarStatusLabel(item: Parameters<typeof calendarStatus>[0], now?: string) {
  const status = calendarStatus(item, now);
  if (status === "recurring") return repeatLabel(item);
  if (item.systemKind === "azure_pat")
    return status === "overdue" ? "Токен просрочен" : "Токен скоро истечёт";
  if (item.ticket) {
    if (status === "overdue") return "Дедлайн просрочен";
    if (status === "ongoing") return "Дедлайн приближается";
    if (status === "upcoming") return "Дедлайн впереди";
    if (status === "completed") return "Напоминание завершено";
  }
  return statusLabels[status];
}

export function repeatLabel(item: { repeatWeekdays?: number[] }) {
  const days = item.repeatWeekdays ?? [1, 2, 3, 4, 5, 6, 7];
  return days.length === 7
    ? "Ежедневно"
    : "Повтор: " +
        [...days]
          .sort()
          .map((day) => ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][day - 1])
          .join(", ");
}
