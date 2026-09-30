"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Server/first render assumes `serverDefault`; the client value takes over right after hydration. */
export function useMediaQuery(query: string, serverDefault = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}
