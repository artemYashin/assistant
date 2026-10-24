export function wallTime(iso: string, zone: string) {
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const v = (key: string) => p.find((x) => x.type === key)!.value;
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}
// Resolve wall-clock input in the configured zone, not the browser zone.
// Reject DST gaps; choose the earlier occurrence when a clock time repeats.
export function fromWall(value: string, zone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Укажите дату и время.");
  const nominal = Date.parse(value + "Z");
  if (!Number.isFinite(nominal)) throw new Error("Некорректная дата.");
  const candidates = new Set<number>();
  for (const shift of [-86400000, 0, 86400000]) {
    const probe = nominal + shift;
    const offset =
      Date.parse(wallTime(new Date(probe).toISOString(), zone) + "Z") - probe;
    candidates.add(nominal - offset);
  }
  const valid = [...candidates]
    .filter((n) => wallTime(new Date(n).toISOString(), zone) === value)
    .sort((a, b) => a - b);
  if (!valid.length)
    throw new Error(
      "Такого местного времени нет в выбранном часовом поясе (переход часов). Выберите другое время.",
    );
  return new Date(valid[0]).toISOString();
}
export function eventTime(
  start: string | null,
  end: string | null,
  zone: string,
) {
  const format = (s: string) =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: zone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(s));
  return start ? format(start) + (end ? " — " + format(end) : "") : "Без срока";
}
