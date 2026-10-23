export function policyChecks(values: any[]) {
  return values
    .filter(
      (p) =>
        p.configuration?.isEnabled !== false &&
        p.configuration?.isDeleted !== true,
    )
    .map((p) => ({
      name: String(
        p.configuration?.settings?.displayName ||
          p.configuration?.type?.displayName ||
          "Проверка Azure",
      ).slice(0, 200),
      state: String(p.status || "unknown"),
      required: p.configuration?.isBlocking === true,
      buildId: Number.isSafeInteger(Number(p.context?.buildId)) && Number(p.context?.buildId) > 0 ? Number(p.context.buildId) : undefined,
      build: p.configuration?.settings?.buildDefinitionId != null,
    }));
}

export function ciMergeReason(value: unknown): string {
  let health: any;
  try { health = typeof value === "string" ? JSON.parse(value) : value; } catch { return "CI: нет данных — обновите проверки"; }
  if (!health || health.error || !Array.isArray(health.checks)) return "CI: нет данных — обновите проверки";
  const builds = health.checks.filter((c: any) => c.build && c.state !== "notApplicable");
  if (builds.some((c: any) => ["rejected", "broken"].includes(c.state))) return "CI: проверки не прошли";
  return "";
}
