import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FLASH_HOLD_MS } from "@/hooks/usePriceFlash";
import { ApiError } from "@/lib/api";
import { Watchlist, type WatchRow } from "./Watchlist";

const row = (ticker: string, price: number | null, sessionOpen: number | null = 100): WatchRow => ({
  ticker,
  price,
  sessionOpen,
  history: [],
});

function setup(rows: WatchRow[], overrides: Partial<Parameters<typeof Watchlist>[0]> = {}) {
  const props = {
    rows,
    selected: null,
    onSelect: vi.fn(),
    onAdd: vi.fn(async () => {}),
    onRemove: vi.fn(async () => {}),
    ...overrides,
  };
  const utils = render(<Watchlist {...props} />);
  return { ...utils, props, rerenderRows: (next: WatchRow[]) => utils.rerender(<Watchlist {...props} rows={next} />) };
}

describe("Watchlist rendering", () => {
  it("shows price and session change %, with a dash for unpriced tickers", () => {
    setup([row("AAPL", 110), row("PYPL", null, null)]);
    expect(screen.getByTestId("watchlist-price-AAPL")).toHaveTextContent("110.00");
    expect(screen.getByTestId("watchlist-change-AAPL")).toHaveTextContent("+10.00%");
    expect(screen.getByTestId("watchlist-price-PYPL")).toHaveTextContent("—");
    expect(screen.getByTestId("watchlist-change-PYPL")).toHaveTextContent("—");
  });

  it("selects a ticker on click", async () => {
    const { props } = setup([row("AAPL", 110)]);
    await userEvent.click(screen.getByRole("button", { name: "Show AAPL chart" }));
    expect(props.onSelect).toHaveBeenCalledWith("AAPL");
  });
});

describe("price flash", () => {
  it("flashes green on an uptick and red on a downtick, then clears", () => {
    vi.useFakeTimers();
    const { rerenderRows } = setup([row("AAPL", 100)]);
    const cell = screen.getByTestId("watchlist-price-AAPL");
    expect(cell).toHaveAttribute("data-flash", "none");

    rerenderRows([row("AAPL", 101)]);
    expect(cell).toHaveAttribute("data-flash", "up");
    expect(cell).toHaveClass("flash-up");

    act(() => vi.advanceTimersByTime(FLASH_HOLD_MS + 1));
    expect(cell).toHaveAttribute("data-flash", "none");
    expect(cell).not.toHaveClass("flash-up");

    rerenderRows([row("AAPL", 99.5)]);
    expect(cell).toHaveAttribute("data-flash", "down");
    expect(cell).toHaveClass("flash-down");
  });

  it("does not flash when the price is unchanged or first arrives", () => {
    const { rerenderRows } = setup([row("AAPL", null)]);
    rerenderRows([row("AAPL", 100)]);
    expect(screen.getByTestId("watchlist-price-AAPL")).toHaveAttribute("data-flash", "none");
    rerenderRows([row("AAPL", 100)]);
    expect(screen.getByTestId("watchlist-price-AAPL")).toHaveAttribute("data-flash", "none");
  });
});

describe("Watchlist CRUD", () => {
  it("adds an uppercased ticker and clears the input", async () => {
    const { props } = setup([]);
    const input = screen.getByTestId("watchlist-add-input");
    await userEvent.type(input, "pypl");
    await userEvent.click(screen.getByTestId("watchlist-add-button"));
    expect(props.onAdd).toHaveBeenCalledWith("PYPL");
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("shows the API error inline when adding fails", async () => {
    setup([], { onAdd: vi.fn(async () => Promise.reject(new ApiError("Invalid ticker symbol", 400))) });
    await userEvent.type(screen.getByTestId("watchlist-add-input"), "1BAD");
    await userEvent.click(screen.getByTestId("watchlist-add-button"));
    expect(await screen.findByTestId("watchlist-error")).toHaveTextContent("Invalid ticker symbol");
  });

  it("removes a ticker", async () => {
    const { props } = setup([row("AAPL", 100), row("MSFT", 400)]);
    await userEvent.click(screen.getByTestId("watchlist-remove-MSFT"));
    expect(props.onRemove).toHaveBeenCalledWith("MSFT");
  });
});
