import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

// Shared helpers. The backend keeps state across specs (and possibly across runs when the DB
// is not fresh), so tests read the current state through the API and assert on deltas.

export const DEFAULT_TICKERS = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'JPM', 'V', 'NFLX'];

export interface Position {
  ticker: string;
  quantity: number;
  avg_cost: number;
  current_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
}

export interface Portfolio {
  cash_balance: number;
  total_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
  positions: Position[];
}

export interface WatchlistItem {
  ticker: string;
  price: number | null;
  session_open: number | null;
}

/** "$10,000.00" / "-$12.40" / "10000" -> number. Returns NaN when there is no number. */
export function parseMoney(text: string | null | undefined): number {
  if (!text) return NaN;
  const cleaned = text.replace(/[^0-9.\-]/g, '');
  return cleaned ? Number(cleaned) : NaN;
}

/** Rounds a share quantity the way the backend does (4 dp) and drops float noise. */
export function roundQty(q: number): number {
  return Number(q.toFixed(4));
}

export async function getPortfolio(request: APIRequestContext): Promise<Portfolio> {
  const res = await request.get('/api/portfolio');
  expect(res.status(), 'GET /api/portfolio').toBe(200);
  return res.json();
}

export async function getWatchlist(request: APIRequestContext): Promise<WatchlistItem[]> {
  const res = await request.get('/api/watchlist');
  expect(res.status(), 'GET /api/watchlist').toBe(200);
  return (await res.json()).tickers;
}

export function heldQty(p: Portfolio, ticker: string): number {
  return p.positions.find((x) => x.ticker === ticker)?.quantity ?? 0;
}

/** Waits until the backend has a live price for `ticker` and returns it. */
export async function waitForPrice(request: APIRequestContext, ticker: string, timeout = 20_000): Promise<number> {
  let price: number | null = null;
  await expect
    .poll(
      async () => {
        const item = (await getWatchlist(request)).find((t) => t.ticker === ticker);
        price = item?.price ?? null;
        return price;
      },
      { timeout, message: `waiting for a live price for ${ticker}` },
    )
    .not.toBeNull();
  return price as unknown as number;
}

export async function apiTrade(
  request: APIRequestContext,
  ticker: string,
  side: 'buy' | 'sell',
  quantity: number,
) {
  const res = await request.post('/api/portfolio/trade', { data: { ticker, side, quantity } });
  const body = await res.json();
  expect(res.status(), `trade ${side} ${quantity} ${ticker}: ${JSON.stringify(body)}`).toBe(200);
  return body;
}

/** Removes `ticker` from the watchlist if present (404 is fine). */
export async function ensureNotWatched(request: APIRequestContext, ticker: string) {
  const res = await request.delete(`/api/watchlist/${ticker}`);
  expect([204, 404]).toContain(res.status());
}

/** Fails early with a clear message when a non-fresh DB has too little cash for the scenario. */
export async function requireCash(request: APIRequestContext, needed: number) {
  const { cash_balance } = await getPortfolio(request);
  expect(
    cash_balance,
    `scenario needs ~$${needed.toFixed(2)} cash but only $${cash_balance} is available — run against a fresh DB_PATH`,
  ).toBeGreaterThanOrEqual(needed);
}

/** Opens the app and waits for the SSE connection to be live. */
export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
}

export async function moneyOf(locator: Locator): Promise<number> {
  return parseMoney(await locator.textContent());
}

/** Places a trade through the trade bar. */
export async function uiTrade(page: Page, ticker: string, side: 'buy' | 'sell', quantity: number | string) {
  await page.getByTestId('trade-ticker').fill(ticker);
  await page.getByTestId('trade-quantity').fill(String(quantity));
  await page.getByTestId(side === 'buy' ? 'trade-buy' : 'trade-sell').click();
}

/** Header cash must converge to the backend's cash balance (cash does not move with prices). */
export async function expectHeaderCash(page: Page, expected: number) {
  await expect
    .poll(() => moneyOf(page.getByTestId('header-cash')), { message: 'header cash matches backend' })
    .toBeCloseTo(expected, 2);
}
