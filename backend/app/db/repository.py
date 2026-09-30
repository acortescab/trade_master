"""Repository functions over the TraMa tables.

Every function takes an optional ``conn`` (defaults to the process-wide connection) so callers can
compose several calls inside one ``transaction()``, and a ``user_id`` defaulting to DEFAULT_USER_ID.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime

from .connection import get_connection, new_id, to_iso, utc_now_iso
from .schema import DEFAULT_USER_ID

# Below this quantity a position is considered closed (matches the trading rules in PLAN §7).
QTY_EPSILON = 1e-6


@dataclass(frozen=True)
class Position:
    ticker: str
    quantity: float
    avg_cost: float
    updated_at: str


@dataclass(frozen=True)
class Trade:
    id: str
    ticker: str
    side: str
    quantity: float
    price: float
    executed_at: str


def _c(conn: sqlite3.Connection | None) -> sqlite3.Connection:
    return conn if conn is not None else get_connection()


# --- profile -----------------------------------------------------------------------------------


def get_cash(conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID) -> float:
    row = _c(conn).execute(
        "SELECT cash_balance FROM users_profile WHERE id = ?", (user_id,)
    ).fetchone()
    if row is None:
        raise LookupError(f"No profile for user {user_id!r}")
    return float(row["cash_balance"])


def set_cash(
    amount: float, conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID
) -> None:
    cur = _c(conn).execute(
        "UPDATE users_profile SET cash_balance = ? WHERE id = ?", (round(amount, 2), user_id)
    )
    if cur.rowcount == 0:
        raise LookupError(f"No profile for user {user_id!r}")


# --- watchlist ---------------------------------------------------------------------------------


def list_watchlist(
    conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID
) -> list[str]:
    rows = _c(conn).execute(
        "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY added_at, rowid", (user_id,)
    ).fetchall()
    return [r["ticker"] for r in rows]


def add_watchlist(
    ticker: str, conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID
) -> bool:
    """Add a ticker; returns False if it was already present."""
    cur = _c(conn).execute(
        "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
        (new_id(), user_id, ticker, utc_now_iso()),
    )
    return cur.rowcount > 0


def remove_watchlist(
    ticker: str, conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID
) -> bool:
    """Remove a ticker; returns False if it was not present."""
    cur = _c(conn).execute(
        "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?", (user_id, ticker)
    )
    return cur.rowcount > 0


# --- positions ---------------------------------------------------------------------------------


def _position(row: sqlite3.Row) -> Position:
    return Position(
        ticker=row["ticker"],
        quantity=float(row["quantity"]),
        avg_cost=float(row["avg_cost"]),
        updated_at=row["updated_at"],
    )


def get_position(
    ticker: str, conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID
) -> Position | None:
    row = _c(conn).execute(
        "SELECT ticker, quantity, avg_cost, updated_at FROM positions"
        " WHERE user_id = ? AND ticker = ?",
        (user_id, ticker),
    ).fetchone()
    return _position(row) if row else None


def list_positions(
    conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID
) -> list[Position]:
    rows = _c(conn).execute(
        "SELECT ticker, quantity, avg_cost, updated_at FROM positions"
        " WHERE user_id = ? ORDER BY ticker",
        (user_id,),
    ).fetchall()
    return [_position(r) for r in rows]


def upsert_position(
    ticker: str,
    quantity: float,
    avg_cost: float,
    conn: sqlite3.Connection | None = None,
    user_id: str = DEFAULT_USER_ID,
) -> None:
    _c(conn).execute(
        "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?)"
        " ON CONFLICT (user_id, ticker) DO UPDATE SET"
        " quantity = excluded.quantity, avg_cost = excluded.avg_cost,"
        " updated_at = excluded.updated_at",
        (new_id(), user_id, ticker, quantity, avg_cost, utc_now_iso()),
    )


def delete_position(
    ticker: str, conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID
) -> None:
    _c(conn).execute("DELETE FROM positions WHERE user_id = ? AND ticker = ?", (user_id, ticker))


# --- trades ------------------------------------------------------------------------------------


def insert_trade(
    ticker: str,
    side: str,
    quantity: float,
    price: float,
    conn: sqlite3.Connection | None = None,
    user_id: str = DEFAULT_USER_ID,
) -> Trade:
    trade = Trade(
        id=new_id(),
        ticker=ticker,
        side=side,
        quantity=quantity,
        price=price,
        executed_at=utc_now_iso(),
    )
    _c(conn).execute(
        "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (trade.id, user_id, ticker, side, quantity, price, trade.executed_at),
    )
    return trade


def realized_pnl_total(
    conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID
) -> float:
    """Cumulative realized P&L, replaying trades per ticker with the average-cost method."""
    rows = _c(conn).execute(
        "SELECT ticker, side, quantity, price FROM trades"
        " WHERE user_id = ? ORDER BY executed_at, rowid",
        (user_id,),
    ).fetchall()
    holdings: dict[str, tuple[float, float]] = {}  # ticker -> (quantity, avg_cost)
    total = 0.0
    for r in rows:
        qty, avg = holdings.get(r["ticker"], (0.0, 0.0))
        q, p = float(r["quantity"]), float(r["price"])
        if r["side"] == "buy":
            new_qty = qty + q
            avg = (qty * avg + q * p) / new_qty
            qty = new_qty
        else:
            total += (p - avg) * q
            qty -= q
            if qty < QTY_EPSILON:
                qty, avg = 0.0, 0.0
        holdings[r["ticker"]] = (qty, avg)
    return round(total, 2)


# --- snapshots ---------------------------------------------------------------------------------


def insert_snapshot(
    total_value: float, conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID
) -> None:
    _c(conn).execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at)"
        " VALUES (?, ?, ?, ?)",
        (new_id(), user_id, round(total_value, 2), utc_now_iso()),
    )


def list_snapshots(
    since_iso: str, conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID
) -> list[dict]:
    """Snapshots recorded at or after ``since_iso`` (any ISO-8601 form), oldest first."""
    since = to_iso(datetime.fromisoformat(since_iso.replace("Z", "+00:00")))
    rows = _c(conn).execute(
        "SELECT recorded_at, total_value FROM portfolio_snapshots"
        " WHERE user_id = ? AND recorded_at >= ? ORDER BY recorded_at, rowid",
        (user_id, since),
    ).fetchall()
    return [{"recorded_at": r["recorded_at"], "total_value": float(r["total_value"])} for r in rows]


# --- chat --------------------------------------------------------------------------------------


def _chat_item(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "role": row["role"],
        "message": row["content"],
        "actions": json.loads(row["actions"]) if row["actions"] is not None else None,
        "created_at": row["created_at"],
    }


def insert_chat_message(
    role: str,
    content: str,
    actions: list[dict] | None,
    conn: sqlite3.Connection | None = None,
    user_id: str = DEFAULT_USER_ID,
) -> dict:
    """Store a chat message; returns it in the API item shape (PLAN §8)."""
    item = {
        "id": new_id(),
        "role": role,
        "message": content,
        "actions": actions,
        "created_at": utc_now_iso(),
    }
    _c(conn).execute(
        "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (
            item["id"],
            user_id,
            role,
            content,
            json.dumps(actions) if actions is not None else None,
            item["created_at"],
        ),
    )
    return item


def list_chat_messages(
    limit: int = 50, conn: sqlite3.Connection | None = None, user_id: str = DEFAULT_USER_ID
) -> list[dict]:
    """The most recent ``limit`` messages, oldest first."""
    rows = _c(conn).execute(
        "SELECT id, role, content, actions, created_at FROM ("
        "  SELECT rowid AS rid, * FROM chat_messages WHERE user_id = ?"
        "  ORDER BY created_at DESC, rowid DESC LIMIT ?"
        ") ORDER BY created_at, rid",
        (user_id, max(0, limit)),
    ).fetchall()
    return [_chat_item(r) for r in rows]
