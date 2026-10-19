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
      build: p.configuration?.settings?.buildDefinitionId != null,
    }));
}
