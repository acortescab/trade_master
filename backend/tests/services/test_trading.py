"""Trade execution rules (PLAN §7)."""

import asyncio

import pytest

from app import db
from app.services import ServiceError, TradeError
from app.services.trading import execute_trade, normalize_ticker
from app.services.watchlist import remove_ticker


class TestNormalizeTicker:
    @pytest.mark.parametrize(
        ("raw", "expected"), [("aapl", "AAPL"), ("  msft ", "MSFT"), ("brk.b", "BRK.B"), ("V", "V")]
    )
    def test_valid(self, raw, expected):
        assert normalize_ticker(raw) == expected

    @pytest.mark.parametrize("raw", ["", "   ", "1ABC", "TOOLONG", "AB-C", ".AB", "AB1", None])
    def test_invalid(self, raw):
        with pytest.raises(ServiceError, match="Invalid ticker symbol"):
            normalize_ticker(raw)


class TestBuy:
    async def test_buy_debits_cash_and_creates_position(self, source):
        result = await execute_trade("aapl", "buy", 10)
        assert result == {
            "ticker": "AAPL",
            "side": "buy",
            "quantity": 10,
            "price": 190.0,
            "realized_pnl": None,
            "cash_balance": 8100.0,
        }
        assert db.get_cash() == 8100.0
        pos = db.get_position("AAPL")
        assert pos.quantity == 10 and pos.avg_cost == 190.0
        trades = db.get_connection().execute("SELECT * FROM trades").fetchall()
        assert len(trades) == 1 and trades[0]["side"] == "buy" and trades[0]["price"] == 190.0

    async def test_avg_cost_is_weighted(self, source):
        await execute_trade("AAPL", "buy", 10)
        source.set_price("AAPL", 200.0)
        await execute_trade("AAPL", "buy", 30)
        pos = db.get_position("AAPL")
        assert pos.quantity == 40
        assert pos.avg_cost == pytest.approx((10 * 190 + 30 * 200) / 40)

    async def test_fractional_quantity_rounded_to_4dp(self, source):
        result = await execute_trade("AAPL", "buy", 1.234567)
        assert result["quantity"] == 1.2346
        assert db.get_position("AAPL").quantity == 1.2346

    async def test_cash_rounded_to_cents(self, source):
        source.set_price("AAPL", 190.33)
        result = await execute_trade("AAPL", "buy", 0.3333)
        assert result["cash_balance"] == round(10000 - 0.3333 * 190.33, 2)
        assert db.get_cash() == result["cash_balance"]

    async def test_insufficient_cash(self, source):
        with pytest.raises(TradeError, match=r"Insufficient cash: need \$19000.00, have \$10000.00"):
            await execute_trade("AAPL", "buy", 100)
        assert db.get_cash() == 10000.0
        assert db.get_position("AAPL") is None
        assert db.get_connection().execute("SELECT COUNT(*) FROM trades").fetchone()[0] == 0

    async def test_can_spend_exactly_all_cash(self, source):
        source.set_price("AAPL", 100.0)
        result = await execute_trade("AAPL", "buy", 100)
        assert result["cash_balance"] == 0.0

    async def test_buy_auto_adds_to_watchlist(self, source):
        # A held-but-unwatched ticker stays priced; buying more re-adds it to the watchlist.
        await execute_trade("AAPL", "buy", 1)
        await remove_ticker("AAPL")
        assert "AAPL" not in db.list_watchlist()
        await execute_trade("AAPL", "buy", 1)
        assert "AAPL" in db.list_watchlist()

    async def test_buy_of_tracked_unwatched_ticker_adds_to_watchlist(self, source):
        # e.g. the source prices a ticker the watchlist doesn't contain
        await source.add_ticker("PYPL")
        await execute_trade("PYPL", "buy", 1)
        assert "PYPL" in db.list_watchlist()
        assert "PYPL" in source.get_tickers()


class TestSell:
    async def test_sell_credits_cash_and_reports_realized_pnl(self, source):
        await execute_trade("AAPL", "buy", 10)
        source.set_price("AAPL", 200.0)
        result = await execute_trade("AAPL", "sell", 4)
        assert result["realized_pnl"] == 40.0
        assert result["cash_balance"] == 8100.0 + 800.0
        pos = db.get_position("AAPL")
        assert pos.quantity == 6
        assert pos.avg_cost == 190.0  # unchanged by sells
        assert db.realized_pnl_total() == 40.0

    async def test_sell_at_a_loss(self, source):
        await execute_trade("AAPL", "buy", 10)
        source.set_price("AAPL", 180.5)
        result = await execute_trade("AAPL", "sell", 10)
        assert result["realized_pnl"] == -95.0
        assert db.get_cash() == 10000.0 - 95.0

    async def test_selling_full_position_deletes_row(self, source):
        await execute_trade("AAPL", "buy", 2.5)
        await execute_trade("AAPL", "sell", 2.5)
        assert db.get_position("AAPL") is None
        assert db.list_positions() == []

    async def test_sell_more_than_held(self, source):
        await execute_trade("AAPL", "buy", 5)
        with pytest.raises(TradeError, match="Insufficient shares"):
            await execute_trade("AAPL", "sell", 6)
        assert db.get_position("AAPL").quantity == 5

    async def test_sell_without_position(self, source):
        with pytest.raises(TradeError, match="Insufficient shares"):
            await execute_trade("AAPL", "sell", 1)


class TestValidation:
    async def test_no_price_available(self, source):
        # Tracked but the source never priced it (e.g. unknown upstream symbol)
        with pytest.raises(TradeError, match="No price available for ZZZZ"):
            await execute_trade("ZZZZ", "buy", 1)
        assert db.get_cash() == 10000.0

    async def test_invalid_ticker(self, source):
        with pytest.raises(TradeError, match="Invalid ticker symbol"):
            await execute_trade("123", "buy", 1)

    @pytest.mark.parametrize("qty", [0, -1, 0.00001, float("nan"), float("inf"), "abc"])
    async def test_invalid_quantity(self, source, qty):
        with pytest.raises(TradeError):
            await execute_trade("AAPL", "buy", qty)

    async def test_invalid_side(self, source):
        with pytest.raises(TradeError, match="Side must be"):
            await execute_trade("AAPL", "hold", 1)

    async def test_side_is_case_insensitive(self, source):
        result = await execute_trade("AAPL", "BUY", 1)
        assert result["side"] == "buy"


class TestConcurrency:
    async def test_concurrent_buys_cannot_double_spend(self, source):
        # Each buy costs $6,000; only one of two concurrent buys can succeed with $10,000.
        source.set_price("AAPL", 600.0)
        results = await asyncio.gather(
            execute_trade("AAPL", "buy", 10),
            execute_trade("AAPL", "buy", 10),
            return_exceptions=True,
        )
        ok = [r for r in results if isinstance(r, dict)]
        errors = [r for r in results if isinstance(r, TradeError)]
        assert len(ok) == 1 and len(errors) == 1
        assert db.get_cash() == 4000.0
        assert db.get_position("AAPL").quantity == 10

    async def test_concurrent_sells_cannot_oversell(self, source):
        await execute_trade("AAPL", "buy", 10)
        results = await asyncio.gather(
            *(execute_trade("AAPL", "sell", 4) for _ in range(3)), return_exceptions=True
        )
        assert sum(isinstance(r, dict) for r in results) == 2
        assert db.get_position("AAPL").quantity == 2

    async def test_many_small_concurrent_buys_are_all_recorded(self, source):
        await asyncio.gather(*(execute_trade("MSFT", "buy", 1) for _ in range(10)))
        assert db.get_position("MSFT").quantity == 10
        assert db.get_cash() == 10000.0 - 4200.0
