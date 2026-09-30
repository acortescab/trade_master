"use client";

import { useEffect, useState } from "react";

export type Flash = "up" | "down" | null;

/** How long the tint is held before the CSS transition fades it out (~500ms). */
export const FLASH_HOLD_MS = 120;

/** Returns "up"/"down" briefly after `price` changes, then null. */
export function usePriceFlash(price: number | null | undefined): Flash {
  const [prev, setPrev] = useState(price);
  const [flash, setFlash] = useState<Flash>(null);
  const [tick, setTick] = useState(0);

  // Derive from the previous render's price (no effect needed for detection).
  if (price !== prev) {
    setPrev(price);
    if (price != null && prev != null && price !== prev) {
      setFlash(price > prev ? "up" : "down");
      setTick((n) => n + 1);
    }
  }

  useEffect(() => {
    if (tick === 0) return;
    const timer = setTimeout(() => setFlash(null), FLASH_HOLD_MS);
    return () => clearTimeout(timer);
  }, [tick]);

  return flash;
}
