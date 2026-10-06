"""Process-wide application state shared by services and routers."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from app.market import MarketDataSource, PriceCache


@dataclass
class AppState:
    price_cache: PriceCache = field(default_factory=PriceCache)
    market_source: MarketDataSource | None = None
    # Serializes every read-check-write of cash/positions/watchlist (manual and LLM paths).
    trade_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


_state = AppState()


def get_state() -> AppState:
    return _state


def reset_state() -> AppState:
    """Replace the singleton with a fresh AppState (app startup and tests)."""
    global _state
    _state = AppState()
    return _state
