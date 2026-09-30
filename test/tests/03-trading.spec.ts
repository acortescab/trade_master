import { expect, test } from '@playwright/test';
import {
  apiTrade,
  expectHeaderCash,
  getPortfolio,
  heldQty,
  openApp,
  requireCash,
  roundQty,
  uiTrade,
  waitForPrice,
} from './helpers';

test.describe('Trading via the trade bar', () => {
  test('buy shares: cash decreases and the position appears', async ({ page, request }) => {
    const ticker = 'AAPL';
    const price = await waitForPrice(request, ticker);
    await requireCash(request, price * 1.2);
    const before = await getPortfolio(request);
    const qty0 = heldQty(before, ticker);

    await openApp(page);
    await uiTrade(page, ticker, 'buy', 1);

    await expect.poll(async () => heldQty(await getPortfolio(request), ticker)).toBeCloseTo(qty0 + 1, 4);
    const after = await getPortfolio(request);
    const spent = before.cash_balance - after.cash_balance;
    // Filled at the live price (moves slightly between our read and the fill).
    expect(spent).toBeGreaterThan(price * 0.9);
    expect(spent).toBeLessThan(price * 1.1);

    await expectHeaderCash(page, after.cash_balance);
    const row = page.getByTestId(`position-row-${ticker}`);
    await expect(row).toBeVisible();
    await expect(page.getByTestId('positions-table')).toContainText(ticker);
    await expect(page.getByTestId('trade-error')).toHaveCount(0);
  });

  test('sell shares: cash increases, the position shrinks and then disappears', async ({ page, request }) => {
    const ticker = 'JPM';
    const price = await waitForPrice(request, ticker);
    await requireCash(request, price * 2.2);
    await apiTrade(request, ticker, 'buy', 2);
    const before = await getPortfolio(request);
    const qty0 = heldQty(before, ticker);
    expect(qty0).toBeGreaterThanOrEqual(2);

    await openApp(page);
    await expect(page.getByTestId(`position-row-${ticker}`)).toBeVisible();

    // Partial sell.
    await uiTrade(page, ticker, 'sell', 1);
    await expect.poll(async () => heldQty(await getPortfolio(request), ticker)).toBeCloseTo(qty0 - 1, 4);
    const mid = await getPortfolio(request);
    expect(mid.cash_balance).toBeGreaterThan(before.cash_balance);
    await expectHeaderCash(page, mid.cash_balance);
    await expect(page.getByTestId(`position-row-${ticker}`)).toBeVisible();

    // Sell the remainder: the row goes away.
    const remaining = roundQty(qty0 - 1);
    await uiTrade(page, ticker, 'sell', remaining);
    await expect.poll(async () => heldQty(await getPortfolio(request), ticker)).toBe(0);
    const after = await getPortfolio(request);
    expect(after.cash_balance).toBeGreaterThan(mid.cash_balance);
    await expectHeaderCash(page, after.cash_balance);
    await expect(page.getByTestId(`position-row-${ticker}`)).toHaveCount(0);
  });

  test('invalid trades show an inline error and change nothing', async ({ page, request }) => {
    const before = await getPortfolio(request);
    await openApp(page);

    // Insufficient cash.
    await uiTrade(page, 'AAPL', 'buy', 1_000_000);
    await expect(page.getByTestId('trade-error')).toBeVisible();
    await expect(page.getByTestId('trade-error')).toContainText(/insufficient cash/i);

    // Selling more than held (NFLX is never bought by these specs beyond 0 unless the DB is dirty).
    const nflx = heldQty(before, 'NFLX');
    await uiTrade(page, 'NFLX', 'sell', roundQty(nflx + 1000));
    await expect(page.getByTestId('trade-error')).toBeVisible();
    await expect(page.getByTestId('trade-error')).not.toContainText(/insufficient cash/i);

    const after = await getPortfolio(request);
    expect(after.cash_balance).toBeCloseTo(before.cash_balance, 2);
    expect(heldQty(after, 'AAPL')).toBeCloseTo(heldQty(before, 'AAPL'), 4);
    expect(heldQty(after, 'NFLX')).toBeCloseTo(nflx, 4);
    await expectHeaderCash(page, before.cash_balance);
  });
});
