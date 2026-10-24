import { useEffect, useState } from "react";
import releases from "./releases.json" with { type: "json" };
const key = "orbit.updates.last-seen-version";
const version = releases[0].version;
function readSeen() {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function useUnreadRelease(open: boolean) {
  const [seen, setSeen] = useState(readSeen);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setSeen(readSeen());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!open) return;
    setSeen(version);
    try {
      localStorage.setItem(key, version);
    } catch {
      /* Still mark read for this tab. */
    }
  }, [open]);
  return !open && seen !== version;
}
