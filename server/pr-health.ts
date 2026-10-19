export function policyChecks(values: any[]) {
  return values
    .filter((p) => p.configuration?.isEnabled !== false)
    .map((p) => ({
      name: String(
        p.configuration?.settings?.displayName ||
          p.configuration?.type?.displayName ||
          "Проверка Azure",
      ).slice(0, 200),
      state: String(p.status || "unknown"),
      required: p.configuration?.isBlocking === true,
      build: p.configuration?.settings?.buildDefinitionId != null,
      stale:
        p.context?.isExpired === true || p.context?.buildIsNotCurrent === true,
    }));
}
