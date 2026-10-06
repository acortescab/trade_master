import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/components/Header";
import { MockEventSource, tick } from "@/test/mocks";
import { HISTORY_LIMIT, usePriceStream } from "./usePriceStream";

beforeEach(() => MockEventSource.install());

describe("usePriceStream connection status", () => {
  it("walks connected → reconnecting → connected → disconnected", () => {
    const { result } = renderHook(() => usePriceStream());
    const es = MockEventSource.latest();
    expect(es.url).toBe("/api/stream/prices");
    expect(result.current.status).toBe("reconnecting");

    act(() => es.open());
    expect(result.current.status).toBe("connected");

    act(() => es.fail(true)); // browser is auto-retrying
    expect(result.current.status).toBe("reconnecting");

    act(() => es.open());
    expect(result.current.status).toBe("connected");

    act(() => es.fail(false)); // gave up
    expect(result.current.status).toBe("disconnected");
  });

  it("opens a fresh EventSource after the connection closes", () => {
    vi.useFakeTimers();
    renderHook(() => usePriceStream());
    const first = MockEventSource.latest();
    act(() => first.fail(false));
    expect(first.closed).toBe(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("drives the header status dot", () => {
    function Harness() {
      const { status } = usePriceStream();
      return (
        <Header totalValue={null} cash={null} unrealizedPnl={null} realizedPnl={null} status={status} chatOpen onToggleChat={() => {}} />
      );
    }
    render(<Harness />);
    const dot = screen.getByTestId("connection-status");
    expect(dot).toHaveAttribute("data-status", "reconnecting");
    act(() => MockEventSource.latest().open());
    expect(dot).toHaveAttribute("data-status", "connected");
    act(() => MockEventSource.latest().fail(false));
    expect(dot).toHaveAttribute("data-status", "disconnected");
  });

  it("closes the stream on unmount", () => {
    const { unmount } = renderHook(() => usePriceStream());
    unmount();
    expect(MockEventSource.latest().closed).toBe(true);
  });
});

describe("usePriceStream data", () => {
  it("stores prices and accumulates per-ticker history", () => {
    const { result } = renderHook(() => usePriceStream());
    const es = MockEventSource.latest();
    act(() => es.emit({ AAPL: tick("AAPL", 190, { timestamp: 1 }), MSFT: tick("MSFT", 420, { timestamp: 1 }) }));
    act(() => es.emit({ AAPL: tick("AAPL", 191, { timestamp: 2 }), MSFT: tick("MSFT", 419, { timestamp: 2 }) }));
    expect(result.current.prices.AAPL.price).toBe(191);
    expect(result.current.history.AAPL.map((p) => p.p)).toEqual([190, 191]);
    expect(result.current.status).toBe("connected");
  });

  it("drops tickers missing from an event", () => {
    const { result } = renderHook(() => usePriceStream());
    const es = MockEventSource.latest();
    act(() => es.emit({ AAPL: tick("AAPL", 190, { timestamp: 1 }), PYPL: tick("PYPL", 60, { timestamp: 1 }) }));
    act(() => es.emit({ AAPL: tick("AAPL", 190.5, { timestamp: 2 }) }));
    expect(Object.keys(result.current.prices)).toEqual(["AAPL"]);
    expect(result.current.history.PYPL).toBeUndefined();
  });

  it("caps history length", () => {
    const { result } = renderHook(() => usePriceStream());
    const es = MockEventSource.latest();
    act(() => {
      for (let i = 0; i < HISTORY_LIMIT + 25; i++) es.emit({ AAPL: tick("AAPL", 100 + i, { timestamp: i }) });
    });
    const h = result.current.history.AAPL;
    expect(h).toHaveLength(HISTORY_LIMIT);
    expect(h[h.length - 1].p).toBe(100 + HISTORY_LIMIT + 24);
  });
});
