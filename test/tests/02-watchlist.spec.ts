import { expect, test } from '@playwright/test';
import { ensureNotWatched, getWatchlist, openApp } from './helpers';

const TICKER = 'PYPL';

test.describe('Watchlist', () => {
  test.beforeEach(async ({ request }) => {
    await ensureNotWatched(request, TICKER);
  });

  test.afterAll(async ({ request }) => {
    await ensureNotWatched(request, TICKER);
  });

  test('add and remove a ticker', async ({ page, request }) => {
    await openApp(page);
    await expect(page.getByTestId(`watchlist-row-${TICKER}`)).toHaveCount(0);

    await page.getByTestId('watchlist-add-input').fill(TICKER);
    await page.getByTestId('watchlist-add-button').click();

    const row = page.getByTestId(`watchlist-row-${TICKER}`);
    await expect(row).toBeVisible();
    // New ticker gets priced by the stream.
    await expect(page.getByTestId(`watchlist-price-${TICKER}`)).toHaveText(/\d/, { timeout: 15_000 });
    expect((await getWatchlist(request)).map((t) => t.ticker)).toContain(TICKER);

    await page.getByTestId(`watchlist-remove-${TICKER}`).click();
    await expect(row).toHaveCount(0);
    await expect
      .poll(async () => (await getWatchlist(request)).map((t) => t.ticker))
      .not.toContain(TICKER);

    // Removal persists across reload.
    await page.reload();
    await expect(page.getByTestId('watchlist-row-AAPL')).toBeVisible();
    await expect(page.getByTestId(`watchlist-row-${TICKER}`)).toHaveCount(0);
  });

  test('ticker input is normalized (lowercase + whitespace)', async ({ page, request }) => {
    await openApp(page);
    await page.getByTestId('watchlist-add-input').fill(`  ${TICKER.toLowerCase()} `);
    await page.getByTestId('watchlist-add-button').click();
    await expect(page.getByTestId(`watchlist-row-${TICKER}`)).toBeVisible();
    expect((await getWatchlist(request)).map((t) => t.ticker)).toContain(TICKER);
  });
});
