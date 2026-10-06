"""Tests for the repository functions."""

from datetime import UTC, datetime, timedelta

import pytest

from app import db


def _add_trade(conn, ticker, side, qty, price, at):
    """Insert a trade with an explicit timestamp (for deterministic replay order)."""
    conn.execute(
        "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at)"
        " VALUES (?, 'default', ?, ?, ?, ?, ?)",
        (db.new_id(), ticker, side, qty, price, at),
    )


class TestProfile:
    def test_set_cash_rounds_to_cents(self, conn):
        db.set_cash(1234.5678)
        assert db.get_cash() == 1234.57

    def test_unknown_user(self, conn):
        with pytest.raises(LookupError):
            db.get_cash(user_id="nobody")
        with pytest.raises(LookupError):
            db.set_cash(1.0, user_id="nobody")


class TestWatchlist:
    def test_add_new_appends_in_order(self, conn):
        assert db.add_watchlist("PYPL") is True
        assert db.list_watchlist()[-1] == "PYPL"

    def test_add_duplicate_returns_false(self, conn):
        assert db.add_watchlist("AAPL") is False
        assert db.list_watchlist().count("AAPL") == 1

    def test_remove(self, conn):
        assert db.remove_watchlist("TSLA") is True
        assert "TSLA" not in db.list_watchlist()
        assert db.remove_watchlist("TSLA") is False

    def test_user_isolation(self, conn):
        db.add_watchlist("PYPL", user_id="other")
        assert db.list_watchlist(user_id="other") == ["PYPL"]
        assert "PYPL" not in db.list_watchlist()


class TestPositions:
    def test_get_missing(self, conn):
        assert db.get_position("AAPL") is None
        assert db.list_positions() == []

    def test_upsert_insert_then_update(self, conn):
        db.upsert_position("AAPL", 10, 190.5)
        p = db.get_position("AAPL")
        assert isinstance(p, db.Position)
        assert (p.ticker, p.quantity, p.avg_cost) == ("AAPL", 10, 190.5)
        assert p.updated_at.endswith("Z")
        db.upsert_position("AAPL", 15.5, 191.0)
        p = db.get_position("AAPL")
        assert (p.quantity, p.avg_cost) == (15.5, 191.0)
        assert conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0] == 1

    def test_list_sorted_by_ticker(self, conn):
        db.upsert_position("TSLA", 1, 1.0)
        db.upsert_position("AAPL", 2, 2.0)
        assert [p.ticker for p in db.list_positions()] == ["AAPL", "TSLA"]

    def test_delete(self, conn):
        db.upsert_position("AAPL", 1, 1.0)
        db.delete_position("AAPL")
        assert db.get_position("AAPL") is None
        db.delete_position("AAPL")  # no-op

    def test_fractional_quantity(self, conn):
        db.upsert_position("NVDA", 0.1234, 800.0)
        assert db.get_position("NVDA").quantity == 0.1234


class TestTrades:
    def test_insert_returns_trade(self, conn):
        t = db.insert_trade("AAPL", "buy", 10, 190.5)
        assert isinstance(t, db.Trade)
        assert (t.ticker, t.side, t.quantity, t.price) == ("AAPL", "buy", 10, 190.5)
        assert t.id and t.executed_at.endswith("Z")
        row = conn.execute("SELECT * FROM trades WHERE id = ?", (t.id,)).fetchone()
        assert row["user_id"] == "default" and row["price"] == 190.5


class TestRealizedPnl:
    def test_no_trades(self, conn):
        assert db.realized_pnl_total() == 0.0

    def test_buys_only(self, conn):
        db.insert_trade("AAPL", "buy", 10, 100.0)
        assert db.realized_pnl_total() == 0.0

    def test_simple_gain_and_loss(self, conn):
        _add_trade(conn, "AAPL", "buy", 10, 100.0, "2026-01-01T00:00:01Z")
        _add_trade(conn, "AAPL", "sell", 4, 110.0, "2026-01-01T00:00:02Z")  # +40
        _add_trade(conn, "TSLA", "buy", 2, 200.0, "2026-01-01T00:00:03Z")
        _add_trade(conn, "TSLA", "sell", 2, 150.0, "2026-01-01T00:00:04Z")  # -100
        assert db.realized_pnl_total() == -60.0

    def test_average_cost_across_buys_and_partial_sells(self, conn):
        _add_trade(conn, "AAPL", "buy", 10, 100.0, "2026-01-01T00:00:01Z")
        _add_trade(conn, "AAPL", "buy", 10, 200.0, "2026-01-01T00:00:02Z")  # avg 150
        _add_trade(conn, "AAPL", "sell", 5, 160.0, "2026-01-01T00:00:03Z")  # +50
        _add_trade(conn, "AAPL", "buy", 5, 110.0, "2026-01-01T00:00:04Z")  # (15*150+5*110)/20 = 140
        _add_trade(conn, "AAPL", "sell", 20, 150.0, "2026-01-01T00:00:05Z")  # +200
        assert db.realized_pnl_total() == 250.0

    def test_full_close_then_rebuy_resets_cost_basis(self, conn):
        _add_trade(conn, "AAPL", "buy", 10, 100.0, "2026-01-01T00:00:01Z")
        _add_trade(conn, "AAPL", "sell", 10, 120.0, "2026-01-01T00:00:02Z")  # +200
        _add_trade(conn, "AAPL", "buy", 5, 300.0, "2026-01-01T00:00:03Z")  # fresh avg 300
        _add_trade(conn, "AAPL", "sell", 5, 290.0, "2026-01-01T00:00:04Z")  # -50
        assert db.realized_pnl_total() == 150.0

    def test_same_timestamp_uses_insertion_order(self, conn):
        at = "2026-01-01T00:00:00Z"
        _add_trade(conn, "AAPL", "buy", 1, 100.0, at)
        _add_trade(conn, "AAPL", "sell", 1, 105.0, at)
        _add_trade(conn, "AAPL", "buy", 1, 200.0, at)
        assert db.realized_pnl_total() == 5.0

    def test_fractional_rounds_to_cents(self, conn):
        _add_trade(conn, "NVDA", "buy", 0.3333, 3.0, "2026-01-01T00:00:01Z")
        _add_trade(conn, "NVDA", "sell", 0.3333, 4.0, "2026-01-01T00:00:02Z")
        assert db.realized_pnl_total() == 0.33

    def test_user_isolation(self, conn):
        db.insert_trade("AAPL", "buy", 1, 100.0, user_id="other")
        db.insert_trade("AAPL", "sell", 1, 150.0, user_id="other")
        assert db.realized_pnl_total() == 0.0
        assert db.realized_pnl_total(user_id="other") == 50.0


class TestSnapshots:
    def _add(self, conn, value, at):
        conn.execute(
            "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at)"
            " VALUES (?, 'default', ?, ?)",
            (db.new_id(), value, at),
        )

    def test_insert_and_list(self, conn):
        db.insert_snapshot(10000.123)
        since = db.to_iso(datetime.now(UTC) - timedelta(hours=1))
        snaps = db.list_snapshots(since)
        assert len(snaps) == 1
        assert snaps[0]["total_value"] == 10000.12
        assert set(snaps[0]) == {"recorded_at", "total_value"}

    def test_filters_and_orders(self, conn):
        self._add(conn, 3.0, "2026-01-01T12:00:00Z")
        self._add(conn, 1.0, "2026-01-01T10:00:00Z")
        self._add(conn, 2.0, "2026-01-01T11:00:00Z")
        snaps = db.list_snapshots("2026-01-01T11:00:00Z")
        assert [s["total_value"] for s in snaps] == [2.0, 3.0]

    @pytest.mark.parametrize(
        "since",
        ["2026-01-01T11:00:00+00:00", "2026-01-01T11:00:00", "2026-01-01T13:00:00+02:00",
         "2026-01-01T11:00:00.000Z"],
    )
    def test_accepts_iso_variants(self, conn, since):
        self._add(conn, 1.0, "2026-01-01T10:59:59Z")
        self._add(conn, 2.0, "2026-01-01T11:00:00Z")
        assert [s["total_value"] for s in db.list_snapshots(since)] == [2.0]


class TestChat:
    def test_insert_returns_api_shape(self, conn):
        m = db.insert_chat_message("user", "buy 1 AAPL", None)
        assert set(m) == {"id", "role", "message", "actions", "created_at"}
        assert m["role"] == "user" and m["message"] == "buy 1 AAPL" and m["actions"] is None

    def test_actions_roundtrip(self, conn):
        actions = [
            {"type": "trade", "ticker": "AAPL", "side": "buy", "quantity": 1,
             "status": "ok", "price": 190.5, "error": None},
            {"type": "watchlist", "ticker": "PYPL", "action": "add",
             "status": "error", "error": "Invalid ticker symbol"},
        ]
        m = db.insert_chat_message("assistant", "Done.", actions)
        [restored] = db.list_chat_messages()
        assert restored == m
        assert restored["actions"] == actions

    def test_empty_actions_list_preserved(self, conn):
        db.insert_chat_message("assistant", "Hi", [])
        assert db.list_chat_messages()[0]["actions"] == []

    def test_oldest_first_and_limit_keeps_most_recent(self, conn):
        for i in range(6):
            db.insert_chat_message("user" if i % 2 == 0 else "assistant", f"m{i}", None)
        assert [m["message"] for m in db.list_chat_messages()] == [f"m{i}" for i in range(6)]
        assert [m["message"] for m in db.list_chat_messages(limit=3)] == ["m3", "m4", "m5"]
        assert db.list_chat_messages(limit=0) == []

    def test_user_isolation(self, conn):
        db.insert_chat_message("user", "x", None, user_id="other")
        assert db.list_chat_messages() == []
