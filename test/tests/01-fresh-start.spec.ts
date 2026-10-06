import { expect, test } from '@playwright/test';
import { DEFAULT_TICKERS, expectHeaderCash, getPortfolio, moneyOf, openApp } from './helpers';

test.describe('Fresh start', () => {
  test('shows the default watchlist, cash, live prices and a green connection dot', async ({ page, request }) => {
    const portfolio = await getPortfolio(request);
    await openApp(page);

    // Default watchlist (our specs always restore the defaults they touch).
    for (const t of DEFAULT_TICKERS) {
      await expect(page.getByTestId(`watchlist-row-${t}`), `watchlist row ${t}`).toBeVisible();
    }

    // Cash: exactly $10,000 on an untouched DB, otherwise whatever the backend reports.
    const untouched = portfolio.positions.length === 0 && portfolio.cash_balance === 10000;
    if (untouched || process.env.E2E_FRESH_DB === '1') {
      await expect(page.getByTestId('header-cash')).toContainText('10,000');
      await expectHeaderCash(page, 10000);
    } else {
      test.info().annotations.push({ type: 'note', description: 'DB not fresh — compared cash to API instead of $10,000' });
      await expectHeaderCash(page, portfolio.cash_balance);
    }

    // Total value is shown and in line with the backend (it moves with live prices).
    await expect
      .poll(() => moneyOf(page.getByTestId('header-total-value')))
      .toBeGreaterThan(0);
    const total = await moneyOf(page.getByTestId('header-total-value'));
    expect(Math.abs(total - portfolio.total_value) / portfolio.total_value).toBeLessThan(0.1);

    // Prices are priced and streaming: every default ticker gets a number, and some price changes.
    const priceText = (t: string) => page.getByTestId(`watchlist-price-${t}`).textContent();
    for (const t of DEFAULT_TICKERS) {
      await expect(page.getByTestId(`watchlist-price-${t}`)).toHaveText(/\d/);
    }
    const initial = await Promise.all(DEFAULT_TICKERS.map(priceText));
    await expect
      .poll(async () => {
        const now = await Promise.all(DEFAULT_TICKERS.map(priceText));
        return now.some((p, i) => p !== initial[i]);
      }, { message: 'at least one watchlist price changes (SSE streaming)', timeout: 15_000 })
      .toBe(true);

    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');

    // The main chart area is present (default or first selected ticker).
    await expect(page.getByTestId('main-chart')).toBeVisible();
  });

  test('clicking a watchlist ticker selects it in the main chart', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('watchlist-row-MSFT').click();
    await expect(page.getByTestId('main-chart')).toContainText('MSFT');
  });
});
