import { vi } from "vitest";
import type { PriceUpdate } from "@/lib/types";

/** Controllable stand-in for the browser EventSource. */
export class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];

  readyState = MockEventSource.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  static latest() {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }

  static install() {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  }

  open() {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.(new Event("open"));
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  /** Simulate a dropped connection; `retrying` mirrors the browser's auto-reconnect state. */
  fail(retrying: boolean) {
    this.readyState = retrying ? MockEventSource.CONNECTING : MockEventSource.CLOSED;
    this.onerror?.(new Event("error"));
  }

  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }
}

export function tick(ticker: string, price: number, opts: Partial<PriceUpdate> = {}): PriceUpdate {
  const previous = opts.previous_price ?? price;
  return {
    ticker,
    price,
    previous_price: previous,
    session_open: opts.session_open ?? 100,
    timestamp: opts.timestamp ?? Date.now() / 1000,
    change: price - previous,
    change_percent: previous ? ((price - previous) / previous) * 100 : 0,
    direction: price > previous ? "up" : price < previous ? "down" : "flat",
  };
}

type Route = { method?: string; path: string | RegExp; status?: number; body?: unknown };

/** Stub fetch with a small route table; returns the spy so tests can inspect calls. */
export function mockFetch(routes: Route[]) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const route = routes.find(
      (r) =>
        (r.method ?? "GET").toUpperCase() === method &&
        (typeof r.path === "string" ? url === r.path : r.path.test(url)),
    );
    if (!route) return new Response(JSON.stringify({ detail: `No mock for ${method} ${url}` }), { status: 404 });
    const status = route.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(route.body ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
