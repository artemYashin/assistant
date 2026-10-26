const fallbackZones = [
  "UTC",
  "Asia/Bishkek",
  "Asia/Almaty",
  "Europe/Moscow",
  "Europe/Berlin",
  "America/New_York",
];

/** Offset at this instant, not a replacement for the saved IANA timezone. */
export function timeZoneOffset(zone: string, at = new Date()): string {
  try {
    const offset = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    return offset?.replace(/^GMT/, "UTC") || "UTC";
  } catch {
    return "смещение недоступно";
  }
}
export function timeZoneOptions(current: string, at = new Date()) {
  let supported: string[] = [];
  try {
    supported =
      (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
        "timeZone",
      ) || [];
  } catch {
    /* Older browsers retain saved timezone and fallback choices. */
  }
  let browser = "";
  try {
    browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {}
  return [...new Set(["UTC", current, browser, ...supported, ...fallbackZones].filter(Boolean))]
    .sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)))
    .map((zone) => ({ value: zone, label: timeZoneOffset(zone, at) + " · " + zone }));
}
