"""Watchlist management and the tracked-ticker set (watchlist ∪ open positions, PLAN §6)."""

from __future__ import annotations

from app import db
from app.state import get_state

from .errors import ServiceError, WatchlistError, WatchlistNotFound
from .trading import normalize_ticker


def _normalize(raw: str) -> str:
    try:
        return normalize_ticker(raw)
    except ServiceError as e:
        raise WatchlistError(str(e)) from None


def _item(ticker: str) -> dict:
    update = get_state().price_cache.get(ticker)
    if update is None:
        return {"ticker": ticker, "price": None, "session_open": None}
    session_open = update.price if update.session_open is None else update.session_open
    return {"ticker": ticker, "price": update.price, "session_open": session_open}


def tracked_tickers() -> list[str]:
    """Tickers the market source should price: watchlist order, then unwatched positions."""
    tickers = db.list_watchlist()
    seen = set(tickers)
    for position in db.list_positions():
        if position.ticker not in seen:
            tickers.append(position.ticker)
            seen.add(position.ticker)
    return tickers


def get_watchlist() -> list[dict]:
    return [_item(ticker) for ticker in db.list_watchlist()]


async def add_ticker(ticker: str) -> tuple[dict, bool]:
    """Add a ticker (idempotent). Returns (item, created)."""
    ticker = _normalize(ticker)
    state = get_state()
    async with state.trade_lock:
        with db.transaction() as conn:
            created = db.add_watchlist(ticker, conn=conn)
        source = state.market_source
        if source is not None and ticker not in source.get_tickers():
            await source.add_ticker(ticker)
    return _item(ticker), created


async def remove_ticker(ticker: str) -> None:
    """Remove a ticker; keeps pricing it if a position is open. Raises WatchlistNotFound."""
    ticker = _normalize(ticker)
    state = get_state()
    async with state.trade_lock:
        with db.transaction() as conn:
            removed = db.remove_watchlist(ticker, conn=conn)
            has_position = db.get_position(ticker, conn=conn) is not None
        if not removed:
            raise WatchlistNotFound(f"{ticker} is not on the watchlist")
        source = state.market_source
        if source is not None and not has_position:
            await source.remove_ticker(ticker)
