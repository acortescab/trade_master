"""Process-wide SQLite connection, lazy initialization, and transactions."""

from __future__ import annotations

import sqlite3
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from .schema import DEFAULT_CASH_BALANCE, DEFAULT_USER_ID, DEFAULT_WATCHLIST, SCHEMA_SQL

_conn: sqlite3.Connection | None = None
_lock = threading.RLock()


def utc_now_iso() -> str:
    """Current time as ISO-8601 UTC with a Z suffix (second precision)."""
    return to_iso(datetime.now(UTC))


def to_iso(dt: datetime) -> str:
    """Format a datetime as ISO-8601 UTC with a Z suffix. Naive datetimes are taken as UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id() -> str:
    return str(uuid.uuid4())


def _connect(db_path: str) -> sqlite3.Connection:
    # isolation_level=None: autocommit; transaction() issues BEGIN IMMEDIATE explicitly.
    conn = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _seed(conn: sqlite3.Connection) -> None:
    """Seed the default profile; the default watchlist is only seeded alongside a new profile."""
    now = utc_now_iso()
    cur = conn.execute(
        "INSERT OR IGNORE INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
        (DEFAULT_USER_ID, DEFAULT_CASH_BALANCE, now),
    )
    if cur.rowcount:
        conn.executemany(
            "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            [(new_id(), DEFAULT_USER_ID, t, now) for t in DEFAULT_WATCHLIST],
        )


def init_db(db_path: str) -> None:
    """Open the process-wide connection, creating tables and seed data if missing. Idempotent."""
    global _conn
    with _lock:
        close_db()
        path = Path(db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = _connect(str(path))
        conn.executescript(SCHEMA_SQL)
        conn.execute("BEGIN IMMEDIATE")
        try:
            _seed(conn)
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            conn.close()
            raise
        _conn = conn


def close_db() -> None:
    """Close the process-wide connection (if open)."""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None


def get_connection() -> sqlite3.Connection:
    if _conn is None:
        raise RuntimeError("Database not initialized; call init_db() first")
    return _conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """BEGIN IMMEDIATE ... COMMIT, rolling back on any exception.

    Re-entrant: a nested transaction() joins the outer one (the outer block commits).
    """
    with _lock:
        conn = get_connection()
        if conn.in_transaction:
            yield conn
            return
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")
