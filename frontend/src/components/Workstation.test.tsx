import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { Portfolio } from "@/lib/types";
import { MockEventSource, mockFetch, tick } from "@/test/mocks";
import { Workstation } from "./Workstation";

const portfolio: Portfolio = {
  cash_balance: 8095,
  total_value: 10000,
  unrealized_pnl: 0,
  realized_pnl: 0,
  positions: [
    { ticker: "AAPL", quantity: 10, avg_cost: 190.5, current_price: 190.5, market_value: 1905, unrealized_pnl: 0, unrealized_pnl_pct: 0 },
  ],
};

const watchlist = {
  tickers: [
    { ticker: "AAPL", price: 190.5, session_open: 190 },
    { ticker: "MSFT", price: 420, session_open: 420 },
  ],
};

const baseRoutes = [
  { path: "/api/portfolio", body: portfolio },
  { path: "/api/watchlist", body: watchlist },
  { path: /\/api\/portfolio\/history/, body: { snapshots: [] } },
  { path: /\/api\/chat\/history/, body: { messages: [] } },
];

beforeEach(() => MockEventSource.install());

describe("Workstation", () => {
  it("renders fetched data and revalues the header live from SSE prices", async () => {
    mockFetch(baseRoutes);
    render(<Workstation />);
    await waitFor(() => expect(screen.getByTestId("header-cash")).toHaveTextContent("$8,095.00"));
    expect(screen.getByTestId("header-total-value")).toHaveTextContent("$10,000.00");
    expect(screen.getByTestId("position-row-AAPL")).toBeInTheDocument();

    act(() => {
      MockEventSource.latest().open();
      MockEventSource.latest().emit({ AAPL: tick("AAPL", 191.74, { session_open: 190 }), MSFT: tick("MSFT", 421) });
    });
    // 8095 + 10 × 191.74
    expect(screen.getByTestId("header-total-value")).toHaveTextContent("$10,012.40");
    expect(screen.getByTestId("header-unrealized")).toHaveTextContent("+$12.40");
    expect(screen.getByTestId("watchlist-price-AAPL")).toHaveTextContent("191.74");
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  });

  it("posts a trade, then refetches portfolio and watchlist", async () => {
    const fetchSpy = mockFetch([
      ...baseRoutes,
      {
        method: "POST",
        path: "/api/portfolio/trade",
        body: { ticker: "MSFT", side: "buy", quantity: 2, price: 420, realized_pnl: null, cash_balance: 7255 },
      },
    ]);
    render(<Workstation />);
    await screen.findByTestId("watchlist-row-MSFT");
    await userEvent.click(screen.getByRole("button", { name: "Show MSFT chart" }));
    expect(screen.getByTestId("trade-ticker")).toHaveValue("MSFT");
    await userEvent.type(screen.getByTestId("trade-quantity"), "2");

    const before = fetchSpy.mock.calls.filter(([u]) => u === "/api/portfolio").length;
    await userEvent.click(screen.getByTestId("trade-buy"));
    expect(await screen.findByTestId("trade-success")).toHaveTextContent("Bought 2 MSFT at $420.00");
    await waitFor(() =>
      expect(fetchSpy.mock.calls.filter(([u]) => u === "/api/portfolio").length).toBe(before + 1),
    );
  });

  it("shows the API detail when a trade is rejected", async () => {
    mockFetch([
      ...baseRoutes,
      { method: "POST", path: "/api/portfolio/trade", status: 400, body: { detail: "Insufficient cash: need $42000.00, have $8095.00" } },
    ]);
    render(<Workstation />);
    await screen.findByTestId("watchlist-row-AAPL");
    await userEvent.type(screen.getByTestId("trade-quantity"), "100");
    await userEvent.click(screen.getByTestId("trade-buy"));
    expect(await screen.findByTestId("trade-error")).toHaveTextContent("Insufficient cash: need $42000.00, have $8095.00");
  });

  it("adds and removes watchlist tickers through the API", async () => {
    const fetchSpy = mockFetch([
      ...baseRoutes,
      { method: "POST", path: "/api/watchlist", status: 201, body: { ticker: "PYPL", price: null, session_open: null } },
      { method: "DELETE", path: "/api/watchlist/MSFT", status: 204 },
    ]);
    render(<Workstation />);
    await screen.findByTestId("watchlist-row-MSFT");

    await userEvent.type(screen.getByTestId("watchlist-add-input"), "pypl");
    await userEvent.click(screen.getByTestId("watchlist-add-button"));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/watchlist", expect.objectContaining({ method: "POST", body: '{"ticker":"PYPL"}' })),
    );

    await userEvent.click(screen.getByTestId("watchlist-remove-MSFT"));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/watchlist/MSFT", expect.objectContaining({ method: "DELETE" })),
    );
  });
});
