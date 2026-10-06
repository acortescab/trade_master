import { expect, test, type Page } from '@playwright/test';
import { getPortfolio, heldQty, openApp, requireCash, waitForPrice } from './helpers';

// Requires the backend to run with LLM_MOCK=true (PLAN §9 mock rules).

async function sendChat(page: Page, text: string) {
  const messages = page.getByTestId('chat-message');
  const count = await messages.count();
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
  // The user's message plus the assistant reply.
  await expect(messages).toHaveCount(count + 2, { timeout: 20_000 });
  await expect(page.getByTestId('chat-loading')).toHaveCount(0);
  return messages.last();
}

test.describe('AI chat (mock LLM)', () => {
  test('"buy 1 AAPL" executes a trade shown inline and the position appears', async ({ page, request }) => {
    const price = await waitForPrice(request, 'AAPL');
    await requireCash(request, price * 1.2);
    const qty0 = heldQty(await getPortfolio(request), 'AAPL');

    await openApp(page);
    const reply = await sendChat(page, 'buy 1 AAPL');
    await expect(reply).toContainText('Buying 1 AAPL');

    const action = reply.getByTestId('chat-action');
    await expect(action).toHaveCount(1);
    await expect(action).toHaveAttribute('data-status', 'ok');
    await expect(action).toContainText('AAPL');
    await expect(action).toContainText('✓');

    await expect.poll(async () => heldQty(await getPortfolio(request), 'AAPL')).toBeCloseTo(qty0 + 1, 4);
    await expect(page.getByTestId('position-row-AAPL')).toBeVisible();
  });

  test('a failing mock action is shown inline as an error', async ({ page, request }) => {
    const qty0 = heldQty(await getPortfolio(request), 'NFLX');
    await openApp(page);
    const reply = await sendChat(page, `sell ${Math.ceil(qty0) + 1000} NFLX`);
    const action = reply.getByTestId('chat-action');
    await expect(action).toHaveAttribute('data-status', 'error');
    await expect(action).toContainText('✗');
    expect(heldQty(await getPortfolio(request), 'NFLX')).toBeCloseTo(qty0, 4);
  });

  test('watchlist actions via chat', async ({ page, request }) => {
    await request.delete('/api/watchlist/PYPL');
    await openApp(page);

    let reply = await sendChat(page, 'add PYPL');
    await expect(reply).toContainText('Adding PYPL');
    await expect(reply.getByTestId('chat-action')).toHaveAttribute('data-status', 'ok');
    await expect(page.getByTestId('watchlist-row-PYPL')).toBeVisible();

    reply = await sendChat(page, 'remove PYPL');
    await expect(reply.getByTestId('chat-action')).toHaveAttribute('data-status', 'ok');
    await expect(page.getByTestId('watchlist-row-PYPL')).toHaveCount(0);
  });

  test('chat history survives a page reload', async ({ page }) => {
    const marker = `e2e history check ${Date.now()}`;
    await openApp(page);
    const reply = await sendChat(page, marker);
    await expect(reply).toContainText('Mock TraMa here');

    await page.reload();
    await expect(page.getByTestId('chat-message').filter({ hasText: marker })).toHaveCount(1);
    // The assistant reply to it is restored right after it.
    const messages = page.getByTestId('chat-message');
    await expect(messages.last()).toContainText('Mock TraMa here');
    // Earlier action results are restored with their status.
    await expect(page.getByTestId('chat-action').first()).toHaveAttribute('data-status', /ok|error/);
  });
});
