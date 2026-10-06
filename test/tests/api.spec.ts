import { expect, test } from '@playwright/test';
import { apiTrade, ensureNotWatched, getPortfolio, heldQty, requireCash, waitForPrice } from './helpers';

// Fast contract checks for PLAN §6/§8 (status codes + response shapes). No browser.

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);

test.describe('System', () => {
  test('GET /api/health', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('GET / serves the frontend', async ({ request }) => {
    test.skip(process.env.E2E_NO_FRONTEND === '1', 'backend-only run (no static export)');
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
  });
});

/** Opens the price stream and returns the first `data:` event payload. */
async function firstPriceEvent(baseURL: string | undefined): Promise<Record<string, any>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let text = '';
  try {
    const res = await fetch(`${baseURL}/api/stream/prices`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    while (!/data: .*\n\n/.test(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  const dataLine = text.split('\n').find((l) => l.startsWith('data: '))!;
  return JSON.parse(dataLine.slice(6));
}

test.describe('SSE /api/stream/prices', () => {
  test('sends retry then an event keyed by ticker with the §6 fields', async ({ baseURL }) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let text = '';
    try {
      const res = await fetch(`${baseURL}/api/stream/prices`, { signal: ctrl.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      while (!/data: .*\n\n/.test(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      await reader.cancel();
    } finally {
      clearTimeout(timer);
      ctrl.abort();
    }
    expect(text.trimStart().startsWith('retry: 1000'), `stream starts with retry: ${JSON.stringify(text.slice(0, 80))}`).toBe(true);
    const dataLine = text.split('\n').find((l) => l.startsWith('data: '))!;
    const payload = JSON.parse(dataLine.slice(6));
    expect(Object.keys(payload)).toContain('AAPL');
    const aapl = payload.AAPL;
    expect(aapl.ticker).toBe('AAPL');
    for (const k of ['price', 'previous_price', 'session_open', 'timestamp', 'change', 'change_percent']) {
      expect(isNum(aapl[k]), `AAPL.${k} = ${aapl[k]}`).toBe(true);
    }
    expect(['up', 'down', 'flat']).toContain(aapl.direction);
  });
});

test.describe('Portfolio API', () => {
  test('GET /api/portfolio shape', async ({ request }) => {
    const p = await getPortfolio(request);
    for (const k of ['cash_balance', 'total_value', 'unrealized_pnl', 'realized_pnl'] as const) {
      expect(isNum(p[k]), k).toBe(true);
    }
    expect(Array.isArray(p.positions)).toBe(true);
    for (const pos of p.positions) {
      expect(typeof pos.ticker).toBe('string');
      expect(isNum(pos.quantity)).toBe(true);
      expect(isNum(pos.avg_cost)).toBe(true);
      for (const k of ['current_price', 'market_value', 'unrealized_pnl', 'unrealized_pnl_pct'] as const) {
        expect(isNumOrNull(pos[k]), `${pos.ticker}.${k}`).toBe(true);
      }
    }
  });

  test('buy then sell: response shapes, avg cost and realized P&L', async ({ request }) => {
    const ticker = 'AMZN';
    const price = await waitForPrice(request, ticker);
    await requireCash(request, price * 1.2);
    const before = await getPortfolio(request);

    const buy = await apiTrade(request, ticker, 'buy', 1);
    expect(buy).toMatchObject({ ticker, side: 'buy', quantity: 1, realized_pnl: null });
    expect(isNum(buy.price)).toBe(true);
    expect(buy.cash_balance).toBeCloseTo(before.cash_balance - buy.price, 1);

    const mid = await getPortfolio(request);
    expect(heldQty(mid, ticker)).toBeCloseTo(heldQty(before, ticker) + 1, 4);
    const avg = mid.positions.find((p) => p.ticker === ticker)!.avg_cost;

    const sell = await apiTrade(request, ticker, 'sell', 1);
    expect(sell).toMatchObject({ ticker, side: 'sell', quantity: 1 });
    expect(isNum(sell.realized_pnl)).toBe(true);
    expect(sell.realized_pnl).toBeCloseTo((sell.price - avg) * 1, 1);
    expect(sell.cash_balance).toBeCloseTo(buy.cash_balance + sell.price, 1);

    const after = await getPortfolio(request);
    expect(after.realized_pnl).toBeCloseTo(mid.realized_pnl + sell.realized_pnl, 1);
    expect(heldQty(after, ticker)).toBeCloseTo(heldQty(before, ticker), 4);
  });

  test('ticker is normalized and fractional quantities round to 4 dp', async ({ request }) => {
    const price = await waitForPrice(request, 'TSLA');
    await requireCash(request, price);
    const buy = await apiTrade(request, '  tsla ', 'buy', 0.123456);
    expect(buy.ticker).toBe('TSLA');
    expect(buy.quantity).toBeCloseTo(0.1235, 6);
    await apiTrade(request, 'TSLA', 'sell', 0.1235);
  });

  test('trade validation errors', async ({ request }) => {
    const post = (data: unknown) => request.post('/api/portfolio/trade', { data: data as object });

    let res = await post({ ticker: 'AAPL', side: 'buy', quantity: 1_000_000 });
    expect(res.status()).toBe(400);
    expect((await res.json()).detail).toMatch(/insufficient cash/i);

    const held = heldQty(await getPortfolio(request), 'NFLX');
    res = await post({ ticker: 'NFLX', side: 'sell', quantity: held + 1000 });
    expect(res.status()).toBe(400);
    expect(typeof (await res.json()).detail).toBe('string');

    res = await post({ ticker: '123!', side: 'buy', quantity: 1 });
    expect(res.status()).toBe(400);
    expect(typeof (await res.json()).detail).toBe('string');

    res = await post({ ticker: 'AAPL', side: 'buy', quantity: 0 });
    expect([400, 422]).toContain(res.status());
    res = await post({ ticker: 'AAPL', side: 'buy', quantity: -5 });
    expect([400, 422]).toContain(res.status());

    res = await post({ ticker: 'AAPL', side: 'hold', quantity: 1 });
    expect([400, 422]).toContain(res.status());

    res = await post({ ticker: 'AAPL', side: 'buy' });
    expect(res.status()).toBe(422);
  });

  test('GET /api/portfolio/history shape', async ({ request }) => {
    for (const url of ['/api/portfolio/history', '/api/portfolio/history?hours=1']) {
      const res = await request.get(url);
      expect(res.status()).toBe(200);
      const { snapshots } = await res.json();
      expect(Array.isArray(snapshots)).toBe(true);
      for (const s of snapshots) {
        expect(typeof s.recorded_at).toBe('string');
        expect(Number.isNaN(Date.parse(s.recorded_at))).toBe(false);
        expect(isNum(s.total_value)).toBe(true);
      }
      const times = snapshots.map((s: { recorded_at: string }) => Date.parse(s.recorded_at));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
  });
});

test.describe('Watchlist API', () => {
  const T = 'PYPL';
  test.beforeEach(async ({ request }) => ensureNotWatched(request, T));
  test.afterAll(async ({ request }) => ensureNotWatched(request, T));

  test('GET shape', async ({ request }) => {
    const res = await request.get('/api/watchlist');
    expect(res.status()).toBe(200);
    const { tickers } = await res.json();
    expect(tickers.length).toBeGreaterThan(0);
    for (const t of tickers) {
      expect(typeof t.ticker).toBe('string');
      expect(isNumOrNull(t.price)).toBe(true);
      expect(isNumOrNull(t.session_open)).toBe(true);
    }
  });

  test('POST 201, repeat POST 200 (idempotent), DELETE 204, DELETE again 404', async ({ request }) => {
    let res = await request.post('/api/watchlist', { data: { ticker: T.toLowerCase() } });
    expect(res.status()).toBe(201);
    const created = await res.json();
    expect(created.ticker).toBe(T);
    expect(created).toHaveProperty('price');
    expect(created).toHaveProperty('session_open');

    res = await request.post('/api/watchlist', { data: { ticker: T } });
    expect(res.status()).toBe(200);
    expect((await res.json()).ticker).toBe(T);

    const list = (await (await request.get('/api/watchlist')).json()).tickers;
    expect(list.filter((t: { ticker: string }) => t.ticker === T)).toHaveLength(1);

    res = await request.delete(`/api/watchlist/${T}`);
    expect(res.status()).toBe(204);
    res = await request.delete(`/api/watchlist/${T}`);
    expect(res.status()).toBe(404);
  });

  test('POST invalid symbol is 400, malformed body is 422', async ({ request }) => {
    let res = await request.post('/api/watchlist', { data: { ticker: 'not a ticker' } });
    expect(res.status()).toBe(400);
    expect(typeof (await res.json()).detail).toBe('string');
    res = await request.post('/api/watchlist', { data: {} });
    expect(res.status()).toBe(422);
  });

  test('unwatched ticker with an open position stays priced; selling out stops pricing', async ({ request, baseURL }) => {
    // Add, buy, remove from watchlist -> still valued in /api/portfolio.
    await request.post('/api/watchlist', { data: { ticker: T } });
    const price = await waitForPrice(request, T);
    await requireCash(request, price * 1.2);
    await apiTrade(request, T, 'buy', 1);
    expect((await request.delete(`/api/watchlist/${T}`)).status()).toBe(204);

    await new Promise((r) => setTimeout(r, 1_500));
    const pos = (await getPortfolio(request)).positions.find((p) => p.ticker === T)!;
    expect(pos, 'position survives watchlist removal').toBeTruthy();
    expect(isNum(pos.current_price), 'still priced after watchlist removal').toBe(true);
    expect(Object.keys(await firstPriceEvent(baseURL)), 'still streamed while held').toContain(T);

    // Selling it (ticker not on watchlist) must still work: it is still tracked.
    const sell = await apiTrade(request, T, 'sell', heldQty(await getPortfolio(request), T));
    expect(sell.side).toBe('sell');
    expect(heldQty(await getPortfolio(request), T)).toBe(0);
    // Neither watched nor held -> no longer tracked, so it drops out of the stream.
    await expect
      .poll(async () => Object.keys(await firstPriceEvent(baseURL)), { timeout: 5_000 })
      .not.toContain(T);
  });
});

test.describe('Chat API (mock LLM)', () => {
  test('POST /api/chat shape + history', async ({ request }) => {
    const marker = `api hello ${Date.now()}`;
    let res = await request.post('/api/chat', { data: { message: marker } });
    expect(res.status()).toBe(200);
    const reply = await res.json();
    expect(reply).toMatchObject({ role: 'assistant', actions: [] });
    expect(typeof reply.id).toBe('string');
    expect(reply.message).toMatch(/Mock TraMa here\. Your portfolio is worth \$/);
    expect(Number.isNaN(Date.parse(reply.created_at))).toBe(false);

    res = await request.get('/api/chat/history?limit=50');
    expect(res.status()).toBe(200);
    const { messages } = await res.json();
    const i = messages.findIndex((m: { message: string }) => m.message === marker);
    expect(i, 'user message in history').toBeGreaterThanOrEqual(0);
    expect(messages[i]).toMatchObject({ role: 'user', actions: null });
    expect(messages[i + 1]).toMatchObject({ id: reply.id, role: 'assistant', message: reply.message, actions: [] });

    res = await request.get('/api/chat/history?limit=2');
    expect((await res.json()).messages.length).toBeLessThanOrEqual(2);
  });

  test('mock trade + watchlist actions carry status/price/error', async ({ request }) => {
    const price = await waitForPrice(request, 'V');
    await requireCash(request, price * 1.2);
    const qty0 = heldQty(await getPortfolio(request), 'V');

    let res = await request.post('/api/chat', { data: { message: 'Buy 1 V' } });
    expect(res.status()).toBe(200);
    let reply = await res.json();
    expect(reply.message).toBe('Buying 1 V.');
    expect(reply.actions).toHaveLength(1);
    expect(reply.actions[0]).toMatchObject({ type: 'trade', ticker: 'V', side: 'buy', quantity: 1, status: 'ok', error: null });
    expect(isNum(reply.actions[0].price)).toBe(true);
    expect(heldQty(await getPortfolio(request), 'V')).toBeCloseTo(qty0 + 1, 4);

    res = await request.post('/api/chat', { data: { message: 'sell 1 V' } });
    reply = await res.json();
    expect(reply.actions[0]).toMatchObject({ type: 'trade', side: 'sell', status: 'ok' });

    res = await request.post('/api/chat', { data: { message: 'sell 99999 V' } });
    reply = await res.json();
    expect(res.status()).toBe(200);
    expect(reply.actions[0]).toMatchObject({ type: 'trade', status: 'error' });
    expect(typeof reply.actions[0].error).toBe('string');

    await ensureNotWatched(request, 'PYPL');
    res = await request.post('/api/chat', { data: { message: 'watch PYPL' } });
    reply = await res.json();
    expect(reply.message).toBe('Adding PYPL to your watchlist.');
    expect(reply.actions[0]).toMatchObject({ type: 'watchlist', ticker: 'PYPL', action: 'add', status: 'ok' });
    res = await request.post('/api/chat', { data: { message: 'unwatch PYPL' } });
    reply = await res.json();
    expect(reply.actions[0]).toMatchObject({ type: 'watchlist', ticker: 'PYPL', action: 'remove', status: 'ok' });
  });

  test('malformed chat body is 422', async ({ request }) => {
    const res = await request.post('/api/chat', { data: {} });
    expect(res.status()).toBe(422);
  });
});
