import { parseTicketFilters } from "./useTicketFilters.js";

// Current filters stay view-specific; saved presets belong to the customer.
export function customerPresetKey(storageKey: string) {
  const match = /^orbit\.ticket-filters\.(active|azure|trash):(.*)$/.exec(
    storageKey,
  );
  if (!match) return storageKey + ".presets";
  try {
    const [, customer] = JSON.parse(match[2]);
    return `orbit.ticket-presets.customer.${match[1]}:${JSON.stringify(customer)}`;
  } catch {
    return storageKey + ".presets";
  }
}

export function migrateCustomerPresets(storage: Storage, storageKey: string) {
  const target = customerPresetKey(storageKey);
  if (storage.getItem(target) !== null) return target;
  const match = /^orbit\.ticket-filters\.(active|azure|trash):(.*)$/.exec(
    storageKey,
  );
  if (!match) return target;
  const [, customer] = JSON.parse(match[2]);
  const prefix = `orbit.ticket-filters.${match[1]}:`;
  const presets: {
    id: string;
    name: string;
    filters: ReturnType<typeof parseTicketFilters>;
  }[] = [];
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!)
    .filter(Boolean)
    .sort();
  for (const key of keys) {
    if (!key.startsWith(prefix) || !key.endsWith(".presets")) continue;
    try {
      const [, savedCustomer, project] = JSON.parse(
        key.slice(prefix.length, -".presets".length),
      );
      if (savedCustomer !== customer) continue;
      const items = JSON.parse(storage.getItem(key) || "[]");
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (
          !item ||
          typeof item.id !== "string" ||
          typeof item.name !== "string" ||
          !item.name.trim()
        )
          continue;
        const filters = parseTicketFilters(item.filters);
        if (
          presets.some(
            (p) =>
              p.name === item.name &&
              JSON.stringify(p.filters) === JSON.stringify(filters),
          )
        )
          continue;
        let name = item.name;
        if (presets.some((p) => p.name === name))
          name += ` (${project || "без проекта"})`;
        const base = name;
        for (let n = 2; presets.some((p) => p.name === name); n++)
          name = `${base} · ${n}`;
        let id = item.id;
        for (let n = 1; presets.some((p) => p.id === id); n++)
          id = `${item.id}:import:${n}`;
        presets.push({ id, name, filters });
      }
    } catch {
      // Keep unreadable legacy entries untouched; recover other projects.
    }
  }
  storage.setItem(target, JSON.stringify(presets));
  return target;
}
