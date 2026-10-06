"""Tests for lazy initialization, seeding, connection management, and transactions."""

import sqlite3
from pathlib import Path

import pytest

from app import db

TABLES = {
    "users_profile",
    "watchlist",
    "positions",
    "trades",
    "portfolio_snapshots",
    "chat_messages",
}


def _tables(conn):
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    return {r["name"] for r in rows}


class TestInit:
    def test_creates_file_parent_dirs_and_tables(self, db_path, conn):
        assert Path(db_path).exists()
        assert TABLES <= _tables(conn)

    def test_seeds_default_profile_and_watchlist(self, conn):
        assert db.get_cash() == 10000.0
        assert db.list_watchlist() == db.DEFAULT_WATCHLIST
        assert len(db.DEFAULT_WATCHLIST) == 10

    def test_idempotent_does_not_reseed(self, db_path, conn):
        db.set_cash(123.45)
        db.remove_watchlist("AAPL")
        db.init_db(db_path)
        assert db.get_cash() == 123.45
        assert "AAPL" not in db.list_watchlist()
        assert len(db.list_watchlist()) == 9

    def test_empty_watchlist_is_not_reseeded(self, db_path, conn):
        for t in db.DEFAULT_WATCHLIST:
            db.remove_watchlist(t)
        db.init_db(db_path)
        assert db.list_watchlist() == []

    def test_reinit_on_existing_empty_file(self, db_path):
        Path(db_path).parent.mkdir(parents=True)
        Path(db_path).touch()
        db.init_db(db_path)
        try:
            assert db.get_cash() == 10000.0
            assert len(db.list_watchlist()) == 10
        finally:
            db.close_db()

    def test_data_persists_across_reopen(self, db_path, conn):
        db.upsert_position("AAPL", 5, 100.0)
        db.close_db()
        db.init_db(db_path)
        assert db.get_position("AAPL").quantity == 5

    def test_pragmas(self, conn):
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.row_factory is sqlite3.Row

    def test_get_connection_before_init_raises(self):
        db.close_db()
        with pytest.raises(RuntimeError):
            db.get_connection()

    def test_user_id_defaults(self, conn):
        conn.execute(
            "INSERT INTO watchlist (id, ticker, added_at) VALUES ('x', 'ZZ', '2026-01-01T00:00:00Z')"
        )
        row = conn.execute("SELECT user_id FROM watchlist WHERE id = 'x'").fetchone()
        assert row["user_id"] == db.DEFAULT_USER_ID


class TestConstraints:
    def test_watchlist_unique(self, conn):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO watchlist (id, user_id, ticker, added_at) VALUES ('a', 'default', 'AAPL', 'x')"
            )

    def test_watchlist_same_ticker_other_user_ok(self, conn):
        assert db.add_watchlist("AAPL", user_id="other") is True

    def test_positions_unique(self, conn):
        db.upsert_position("AAPL", 1, 1.0)
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at)"
                " VALUES ('p', 'default', 'AAPL', 1, 1, 'x')"
            )

    def test_trade_side_check(self, conn):
        with pytest.raises(sqlite3.IntegrityError):
            db.insert_trade("AAPL", "hold", 1, 1.0)

    def test_trade_quantity_check(self, conn):
        with pytest.raises(sqlite3.IntegrityError):
            db.insert_trade("AAPL", "buy", 0, 1.0)

    def test_chat_role_check(self, conn):
        with pytest.raises(sqlite3.IntegrityError):
            db.insert_chat_message("system", "x", None)


class TestTransaction:
    def test_commit(self, conn):
        with db.transaction() as c:
            db.set_cash(500.0, conn=c)
            db.add_watchlist("PYPL", conn=c)
        assert db.get_cash() == 500.0
        assert "PYPL" in db.list_watchlist()
        assert not conn.in_transaction

    def test_rollback_on_error(self, conn):
        with pytest.raises(ValueError):
            with db.transaction() as c:
                db.set_cash(1.0, conn=c)
                db.upsert_position("AAPL", 10, 190.0, conn=c)
                db.insert_trade("AAPL", "buy", 10, 190.0, conn=c)
                raise ValueError("boom")
        assert db.get_cash() == 10000.0
        assert db.get_position("AAPL") is None
        assert db.realized_pnl_total() == 0.0
        assert conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0] == 0
        assert not conn.in_transaction

    def test_rollback_on_integrity_error(self, conn):
        with pytest.raises(sqlite3.IntegrityError):
            with db.transaction() as c:
                db.set_cash(1.0, conn=c)
                db.insert_trade("AAPL", "bogus", 1, 1.0, conn=c)
        assert db.get_cash() == 10000.0

    def test_nested_joins_outer(self, conn):
        with pytest.raises(ValueError):
            with db.transaction():
                with db.transaction():
                    db.set_cash(1.0)
                raise ValueError
        assert db.get_cash() == 10000.0

    def test_is_immediate(self, db_path, conn):
        other = sqlite3.connect(db_path, timeout=0)
        try:
            with db.transaction():
                with pytest.raises(sqlite3.OperationalError):
                    other.execute("BEGIN IMMEDIATE")
        finally:
            other.close()


class TestTimeHelpers:
    def test_utc_now_iso_format(self):
        s = db.utc_now_iso()
        assert s.endswith("Z") and len(s) == 20 and s[10] == "T"

    def test_to_iso_converts_offsets(self):
        from datetime import datetime, timedelta, timezone

        dt = datetime(2026, 1, 1, 12, 0, tzinfo=timezone(timedelta(hours=2)))
        assert db.to_iso(dt) == "2026-01-01T10:00:00Z"
        assert db.to_iso(datetime(2026, 1, 1, 12, 0)) == "2026-01-01T12:00:00Z"
