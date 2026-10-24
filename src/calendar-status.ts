import { calendarStatus } from "../server/calendar-model.js";

export const statusLabels: Record<string, string> = {
  recurring: "Ежедневно",
  today_completed: "Сегодня завершено",
  open: "Без срока",
  upcoming: "Предстоит",
  ongoing: "Идёт сейчас",
  overdue: "Просрочено",
  completed: "Завершено",
};
export function calendarStatusLabel(
  item: Parameters<typeof calendarStatus>[0],
  now?: string,
) {
  const status = calendarStatus(item, now);
  if (item.ticket) {
    if (status === "overdue") return "Дедлайн просрочен";
    if (status === "ongoing") return "Дедлайн приближается";
    if (status === "upcoming") return "Дедлайн впереди";
    if (status === "completed") return "Напоминание завершено";
  }
  return statusLabels[status];
}
