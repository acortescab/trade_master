"""Deterministic market source for service/API tests."""

from __future__ import annotations

from app.market import MarketDataSource, PriceCache


class FakeSource(MarketDataSource):
    """Prices come from a fixed dict; tickers without an entry never get a price."""

    def __init__(self, cache: PriceCache, prices: dict[str, float] | None = None) -> None:
        self.cache = cache
        self.prices = dict(prices or {})
        self.tickers: list[str] = []
        self.started = False
        self.stopped = False

    def _seed(self, ticker: str) -> None:
        if ticker in self.prices:
            self.cache.update(ticker, self.prices[ticker])

    async def start(self, tickers: list[str]) -> None:
        self.started = True
        for t in tickers:
            if t not in self.tickers:
                self.tickers.append(t)
                self._seed(t)

    async def stop(self) -> None:
        self.stopped = True

    async def add_ticker(self, ticker: str) -> None:
        if ticker not in self.tickers:
            self.tickers.append(ticker)
            self._seed(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        if ticker in self.tickers:
            self.tickers.remove(ticker)
        self.cache.remove(ticker)

    def get_tickers(self) -> list[str]:
        return list(self.tickers)

    def set_price(self, ticker: str, price: float) -> None:
        self.prices[ticker] = price
        if ticker in self.tickers:
            self.cache.update(ticker, price)


DEFAULT_PRICES = {
    "AAPL": 190.0,
    "GOOGL": 175.0,
    "MSFT": 420.0,
    "AMZN": 185.0,
    "TSLA": 250.0,
    "NVDA": 800.0,
    "META": 500.0,
    "JPM": 200.0,
    "V": 280.0,
    "NFLX": 600.0,
    "PYPL": 60.0,
    "BRK.B": 410.0,
}
