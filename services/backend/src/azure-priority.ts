/** Azure Priority is read-only and independent of Orbit's local priority. */
export const AZURE_PRIORITY_FIELD = "Microsoft.VSTS.Common.Priority";
export function azurePriorityValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
