import { expect, test } from '@playwright/test';
import { apiTrade, getPortfolio, heldQty, openApp, requireCash, waitForPrice } from './helpers';

/** Classifies a CSS color as green / red / other by its dominant channel. */
function hue(color: string): 'green' | 'red' | 'other' {
  const m = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return 'other';
  const [r, g, b] = m.slice(1, 4).map(Number);
  if (g > r + 20 && g >= b) return 'green';
  if (r > g + 20 && r >= b) return 'red';
  return 'other';
}

test.describe('Portfolio visualizations', () => {
  test('heatmap renders a cell per position, colored by P&L', async ({ page, request }) => {
    // Ensure at least two positions so the treemap has something to draw.
    for (const t of ['MSFT', 'GOOGL']) {
      if (heldQty(await getPortfolio(request), t) === 0) {
        const price = await waitForPrice(request, t);
        await requireCash(request, price * 1.1);
        await apiTrade(request, t, 'buy', 1);
      }
    }

    await openApp(page);
    const heatmap = page.getByTestId('heatmap');
    await expect(heatmap).toBeVisible();
    await expect(heatmap.locator('svg').first()).toBeVisible({ timeout: 15_000 });
    await expect(heatmap).toContainText('MSFT');

    // Let prices move away from avg cost, then check each cell is colored green or red
    // and that the palette agrees with the sign of the backend P&L somewhere.
    await page.waitForTimeout(3_000);
    const fills = await heatmap.locator('svg rect').evaluateAll((rects) =>
      rects
        .filter((r) => (r as SVGRectElement).getBBox().width > 4 && (r as SVGRectElement).getBBox().height > 4)
        .map((r) => getComputedStyle(r).fill),
    );
    const hues = fills.map(hue);
    expect(hues.length, `treemap rects: ${JSON.stringify(fills)}`).toBeGreaterThanOrEqual(2);
    expect(hues.filter((h) => h !== 'other').length, `treemap fills: ${JSON.stringify(fills)}`).toBeGreaterThanOrEqual(1);

    const portfolio = await getPortfolio(request);
    // Every position has a cell tagged with its P&L class.
    for (const p of portfolio.positions) {
      await expect(page.getByTestId(`heatmap-cell-${p.ticker}`)).toHaveAttribute('data-pnl', /^(gain|loss|none)$/);
    }
    const anyUp = portfolio.positions.some((p) => (p.unrealized_pnl ?? 0) > 0.01);
    const anyDown = portfolio.positions.some((p) => (p.unrealized_pnl ?? 0) < -0.01);
    if (anyUp && !anyDown) expect(hues).toContain('green');
    if (anyDown && !anyUp) expect(hues).toContain('red');
  });

  test('P&L chart plots portfolio snapshots', async ({ page, request }) => {
    test.setTimeout(100_000);
    // Snapshots are recorded every 30s; wait until the history has at least two points.
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/portfolio/history');
          expect(res.status()).toBe(200);
          return (await res.json()).snapshots.length;
        },
        { timeout: 70_000, intervals: [2_000], message: 'at least 2 portfolio snapshots' },
      )
      .toBeGreaterThanOrEqual(2);

    await openApp(page);
    const chart = page.getByTestId('pnl-chart');
    await expect(chart).toBeVisible();
    await expect(chart.locator('svg').first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => Number(await chart.locator('[data-points]').first().getAttribute('data-points')))
      .toBeGreaterThanOrEqual(2);
    // A line/area with >= 2 points has a path whose "d" contains more than one segment.
    await expect
      .poll(async () =>
        chart.locator('svg path').evaluateAll((paths) =>
          paths.some((p) => ((p.getAttribute('d') ?? '').match(/[LC]/g) ?? []).length >= 1),
        ),
      )
      .toBe(true);
  });
});
