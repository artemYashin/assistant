import { useEffect, useState } from "react";

/** Refresh on minute boundaries and after a suspended/background tab resumes. */
export function useCalendarClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const instant = Date.now();
      setNow(instant);
      timer = setTimeout(refresh, 60000 - (instant % 60000));
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return now;
}
