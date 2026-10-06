"""Portfolio valuation, history and snapshots."""

import asyncio

import pytest

from app import db
from app.services.portfolio import get_history, get_portfolio
from app.services.snapshots import record_snapshot, snapshot_loop
from app.services.trading import execute_trade


async def test_fresh_portfolio(source):
    assert get_portfolio() == {
        "cash_balance": 10000.0,
        "total_value": 10000.0,
        "unrealized_pnl": 0.0,
        "realized_pnl": 0.0,
        "positions": [],
    }


async def test_valuation_with_price_move(source):
    await execute_trade("AAPL", "buy", 10)
    source.set_price("AAPL", 191.74)
    p = get_portfolio()
    assert p["cash_balance"] == 8100.0
    assert p["total_value"] == 10017.40
    assert p["unrealized_pnl"] == 17.40
    assert p["positions"] == [
        {
            "ticker": "AAPL",
            "quantity": 10,
            "avg_cost": 190.0,
            "current_price": 191.74,
            "market_value": 1917.40,
            "unrealized_pnl": 17.40,
            "unrealized_pnl_pct": 0.92,
        }
    ]


async def test_realized_pnl_accumulates(source):
    await execute_trade("AAPL", "buy", 10)
    source.set_price("AAPL", 200.0)
    await execute_trade("AAPL", "sell", 10)
    await execute_trade("MSFT", "buy", 1)
    source.set_price("MSFT", 410.0)
    await execute_trade("MSFT", "sell", 1)
    p = get_portfolio()
    assert p["realized_pnl"] == 100.0 - 10.0
    assert p["total_value"] == 10090.0


async def test_unpriced_position_valued_at_avg_cost(source):
    await execute_trade("AAPL", "buy", 10)
    source.cache.remove("AAPL")  # e.g. upstream stopped pricing it
    p = get_portfolio()
    assert p["total_value"] == 10000.0
    assert p["unrealized_pnl"] == 0.0
    pos = p["positions"][0]
    assert pos["current_price"] is None
    assert pos["market_value"] is None
    assert pos["unrealized_pnl"] is None
    assert pos["unrealized_pnl_pct"] is None
    assert pos["avg_cost"] == 190.0


async def test_record_snapshot_and_history(source):
    assert record_snapshot() == 10000.0
    await execute_trade("AAPL", "buy", 10)
    source.set_price("AAPL", 200.0)
    record_snapshot()
    history = get_history(24)
    assert [s["total_value"] for s in history] == [10000.0, 10100.0]
    assert history[0]["recorded_at"].endswith("Z")


async def test_history_window_excludes_old_snapshots(source):
    db.get_connection().execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at)"
        " VALUES ('old', 'default', 1.0, '2000-01-01T00:00:00Z')"
    )
    record_snapshot()
    assert [s["total_value"] for s in get_history(24)] == [10000.0]


async def test_snapshot_loop_records_immediately_and_survives_errors(source, monkeypatch):
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom")

    monkeypatch.setattr("app.services.snapshots.record_snapshot", flaky)
    task = asyncio.create_task(snapshot_loop(interval=0.01))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(calls) >= 2
