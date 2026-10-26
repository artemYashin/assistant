type Context = { client: string; project: string };

// Keep both current customer scopes and older project-scoped preferences usable.
export function copyRenamedContextStorage(storage: Storage, previous: Context, name: string) {
  for (const key of Object.keys(storage)) {
    const customer =
      /^(orbit\.ticket-(?:filters|presets)\.customer\.(?:active|azure|trash):)("(?:[^"\\]|\\.)*")(.*)$/.exec(
        key,
      );
    if (!previous.project && customer && JSON.parse(customer[2]) === previous.client) {
      storage.setItem(customer[1] + JSON.stringify(name) + customer[3], storage.getItem(key)!);
      continue;
    }
    const legacy = /^(orbit\.ticket-filters\.(?:active|azure|trash):)(\[.*\])((?:\.[\w-]+)*)$/.exec(
      key,
    );
    if (!legacy) continue;
    let scope: unknown;
    try {
      scope = JSON.parse(legacy[2]);
    } catch {
      continue;
    }
    if (
      !Array.isArray(scope) ||
      scope[1] !== previous.client ||
      (previous.project && scope[2] !== previous.project)
    )
      continue;
    scope[previous.project ? 2 : 1] = name;
    storage.setItem(legacy[1] + JSON.stringify(scope) + legacy[3], storage.getItem(key)!);
  }
}

export function deleteContextStorage(storage: Storage, context: Context) {
  for (const key of Object.keys(storage)) {
    const customer =
      /^(orbit\.ticket-(?:filters|presets)\.customer\.(?:active|azure|trash):)("(?:[^"\\]|\\.)*")(.*)$/.exec(
        key,
      );
    if (!context.project && customer && JSON.parse(customer[2]) === context.client) {
      storage.removeItem(key);
      continue;
    }
    const legacy = /^(orbit\.ticket-filters\.(?:active|azure|trash):)(\[.*\])((?:\.[\w-]+)*)$/.exec(
      key,
    );
    if (!legacy) continue;
    try {
      const scope = JSON.parse(legacy[2]);
      if (
        Array.isArray(scope) &&
        scope[1] === context.client &&
        (!context.project || scope[2] === context.project)
      )
        storage.removeItem(key);
    } catch {
      /* Unrelated browser preferences. */
    }
  }
}
