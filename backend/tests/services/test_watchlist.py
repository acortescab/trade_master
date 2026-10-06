"""Watchlist service and tracked tickers = watchlist ∪ open positions (PLAN §6)."""

import pytest

from app import db
from app.services import WatchlistError, WatchlistNotFound
from app.services.trading import execute_trade
from app.services.watchlist import add_ticker, get_watchlist, remove_ticker, tracked_tickers


async def test_default_watchlist_is_tracked_and_priced(source):
    items = get_watchlist()
    assert [i["ticker"] for i in items] == [
        "AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX",
    ]
    assert items[0] == {"ticker": "AAPL", "price": 190.0, "session_open": 190.0}
    assert set(source.get_tickers()) == {i["ticker"] for i in items}


async def test_session_open_stays_at_first_price(source):
    source.set_price("AAPL", 195.0)
    assert get_watchlist()[0] == {"ticker": "AAPL", "price": 195.0, "session_open": 190.0}


async def test_add_ticker_tracks_and_prices(source):
    item, created = await add_ticker(" pypl ")
    assert created is True
    assert item == {"ticker": "PYPL", "price": 60.0, "session_open": 60.0}
    assert db.list_watchlist()[-1] == "PYPL"
    assert "PYPL" in source.get_tickers()


async def test_add_existing_is_idempotent(source):
    item, created = await add_ticker("AAPL")
    assert created is False
    assert item["ticker"] == "AAPL"
    assert db.list_watchlist().count("AAPL") == 1


async def test_add_unpriced_ticker_returns_nulls(source):
    item, created = await add_ticker("ZZZZ")
    assert created is True
    assert item == {"ticker": "ZZZZ", "price": None, "session_open": None}


async def test_add_invalid_symbol(source):
    with pytest.raises(WatchlistError, match="Invalid ticker symbol"):
        await add_ticker("not a ticker")


async def test_remove_ticker_stops_pricing(source):
    await remove_ticker("nflx")
    assert "NFLX" not in db.list_watchlist()
    assert "NFLX" not in source.get_tickers()
    assert source.cache.get("NFLX") is None


async def test_remove_missing_raises_not_found(source):
    with pytest.raises(WatchlistNotFound):
        await remove_ticker("PYPL")


async def test_remove_watched_ticker_with_open_position_keeps_pricing(source):
    await execute_trade("AAPL", "buy", 3)
    await remove_ticker("AAPL")
    assert "AAPL" not in db.list_watchlist()
    assert "AAPL" in source.get_tickers()
    assert source.cache.get_price("AAPL") == 190.0
    assert "AAPL" in tracked_tickers()


async def test_selling_out_of_unwatched_ticker_stops_pricing(source):
    await execute_trade("AAPL", "buy", 3)
    await remove_ticker("AAPL")
    await execute_trade("AAPL", "sell", 1)
    assert "AAPL" in source.get_tickers()  # still held
    await execute_trade("AAPL", "sell", 2)
    assert "AAPL" not in source.get_tickers()
    assert source.cache.get("AAPL") is None
    assert "AAPL" not in tracked_tickers()


async def test_selling_out_of_watched_ticker_keeps_pricing(source):
    await execute_trade("AAPL", "buy", 3)
    await execute_trade("AAPL", "sell", 3)
    assert "AAPL" in source.get_tickers()


async def test_tracked_tickers_is_union(source):
    await execute_trade("AAPL", "buy", 1)
    await remove_ticker("AAPL")
    await remove_ticker("MSFT")
    tracked = tracked_tickers()
    assert "AAPL" in tracked and "MSFT" not in tracked
    assert len(tracked) == len(set(tracked)) == 9
