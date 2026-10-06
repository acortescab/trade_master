"use client";

import { useEffect, useState } from "react";
import type { ConnectionStatus, PriceMap } from "@/lib/types";

export interface PricePoint {
  t: number; // unix seconds
  p: number;
}

export type PriceHistory = Record<string, PricePoint[]>;

/** ~5 minutes of 500ms ticks per ticker; sparklines use the tail of this. */
export const HISTORY_LIMIT = 600;
const MANUAL_RETRY_MS = 5000;

export interface PriceStreamState {
  prices: PriceMap;
  history: PriceHistory;
  status: ConnectionStatus;
}

/** Fold one SSE event into the price map and per-ticker history. Tickers absent from the event are dropped. */
export function applyPriceEvent(prev: PriceStreamState, event: PriceMap): PriceStreamState {
  const history: PriceHistory = {};
  for (const [ticker, update] of Object.entries(event)) {
    const series = prev.history[ticker] ?? [];
    const last = series[series.length - 1];
    if (last && last.t === update.timestamp) {
      history[ticker] = series;
    } else {
      const next = series.length >= HISTORY_LIMIT ? series.slice(-HISTORY_LIMIT + 1) : series.slice();
      next.push({ t: update.timestamp, p: update.price });
      history[ticker] = next;
    }
  }
  return { ...prev, prices: event, history };
}

/**
 * Subscribes to /api/stream/prices. Status per PLAN §10: open → connected,
 * error while CONNECTING → reconnecting, CLOSED → disconnected (then a manual retry).
 */
export function usePriceStream(url = "/api/stream/prices"): PriceStreamState {
  const [state, setState] = useState<PriceStreamState>({
    prices: {},
    history: {},
    status: "reconnecting",
  });

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const setStatus = (status: ConnectionStatus) =>
      setState((s) => (s.status === status ? s : { ...s, status }));

    const connect = () => {
      const es = new EventSource(url);
      source = es;
      es.onopen = () => setStatus("connected");
      es.onmessage = (msg: MessageEvent<string>) => {
        let event: PriceMap;
        try {
          event = JSON.parse(msg.data) as PriceMap;
        } catch {
          return;
        }
        setState((s) => ({ ...applyPriceEvent(s, event), status: "connected" }));
      };
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          setStatus("disconnected");
          es.close();
          if (!disposed) retryTimer = setTimeout(connect, MANUAL_RETRY_MS);
        } else {
          setStatus("reconnecting");
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [url]);

  return state;
}
