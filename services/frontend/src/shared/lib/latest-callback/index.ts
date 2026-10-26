import { useCallback, useLayoutEffect, useRef } from "react";

/** For event handlers, not reactive inputs: updating a callback must not restart a subscription. */
export function useLatestCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
) {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  }, [callback]);
  return useCallback((...args: Args) => latest.current(...args), []);
}
