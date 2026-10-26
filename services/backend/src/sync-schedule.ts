import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const syncScheduleSchema = z
  .object({
    mode: z.enum(["always", "scheduled"]).default("always"),
    start: time.default("09:00"),
    end: time.default("18:00"),
    days: z.array(z.number().int().min(1).max(7)).max(7).default([1, 2, 3, 4, 5]),
    timeZone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Неизвестный часовой пояс")
      .default("UTC"),
  })
  .strict();
export type SyncSchedule = z.infer<typeof syncScheduleSchema>;

export function syncAllowed(schedule: SyncSchedule, now = new Date()) {
  if (schedule.mode === "always") return true;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: schedule.timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(part("weekday")) + 1;
  const minute = Number(part("hour")) * 60 + Number(part("minute"));
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const start = minutes(schedule.start),
    end = minutes(schedule.end);
  if (start === end) return schedule.days.includes(day);
  if (start < end) return schedule.days.includes(day) && minute >= start && minute < end;
  // A window crossing midnight belongs to the day on which it starts.
  return (
    (minute >= start && schedule.days.includes(day)) ||
    (minute < end && schedule.days.includes(day === 1 ? 7 : day - 1))
  );
}
