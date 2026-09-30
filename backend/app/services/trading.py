"""Trade execution: the single shared path for manual and LLM trades (PLAN §7 Trading Rules)."""

from __future__ import annotations

import logging
import math
import re

from app import db
from app.state import get_state

from .errors import ServiceError, TradeError

logger = logging.getLogger(__name__)

TICKER_RE = re.compile(r"^[A-Z][A-Z.]{0,5}$")
DUST = 1e-6  # Remaining quantity below this closes the position
EPS = 1e-9


def normalize_ticker(raw: str) -> str:
    """Uppercase + strip; raise ServiceError if not a valid symbol."""
    ticker = str(raw or "").strip().upper()
    if not TICKER_RE.match(ticker):
        raise ServiceError("Invalid ticker symbol")
    return ticker


def _normalize_side(raw: str) -> str:
    side = str(raw or "").strip().lower()
    if side not in ("buy", "sell"):
        raise TradeError("Side must be 'buy' or 'sell'")
    return side


def _normalize_quantity(raw: float) -> float:
    try:
        quantity = float(raw)
    except (TypeError, ValueError):
        raise TradeError("Quantity must be a number") from None
    if not math.isfinite(quantity):
        raise TradeError("Quantity must be a number")
    quantity = round(quantity, 4)
    if quantity <= 0:
        raise TradeError("Quantity must be greater than 0")
    return quantity


async def execute_trade(ticker: str, side: str, quantity: float) -> dict:
    """Execute a market order at the current cached price.

    Returns {"ticker","side","quantity","price","realized_pnl","cash_balance"}.
    Raises TradeError / ServiceError on any rule violation; nothing is written in that case.
    """
    try:
        ticker = normalize_ticker(ticker)
    except ServiceError as e:
        raise TradeError(str(e)) from None
    side = _normalize_side(side)
    quantity = _normalize_quantity(quantity)

    state = get_state()
    async with state.trade_lock:
        price = state.price_cache.get_price(ticker)
        if price is None:
            raise TradeError(f"No price available for {ticker}")

        realized_pnl: float | None = None
        closed_unwatched = False
        with db.transaction() as conn:
            cash = db.get_cash(conn=conn)
            position = db.get_position(ticker, conn=conn)

            if side == "buy":
                cost = round(quantity * price, 2)
                if cost > cash + EPS:
                    raise TradeError(f"Insufficient cash: need ${cost:.2f}, have ${cash:.2f}")
                old_qty = position.quantity if position else 0.0
                old_avg = position.avg_cost if position else 0.0
                new_qty = round(old_qty + quantity, 4)
                new_avg = (old_qty * old_avg + quantity * price) / (old_qty + quantity)
                db.upsert_position(ticker, new_qty, new_avg, conn=conn)
                db.add_watchlist(ticker, conn=conn)  # no-op if already watched
                new_cash = max(cash - quantity * price, 0.0)
            else:
                held = position.quantity if position else 0.0
                if position is None or quantity > held + EPS:
                    raise TradeError(
                        f"Insufficient shares: cannot sell {quantity:g} {ticker}, you hold {held:g}"
                    )
                realized_pnl = round((price - position.avg_cost) * quantity, 2)
                remaining = round(held - quantity, 4)
                if remaining < DUST:
                    db.delete_position(ticker, conn=conn)
                    closed_unwatched = ticker not in db.list_watchlist(conn=conn)
                else:
                    db.upsert_position(ticker, remaining, position.avg_cost, conn=conn)
                new_cash = cash + quantity * price

            db.insert_trade(ticker, side, quantity, price, conn=conn)
            db.set_cash(new_cash, conn=conn)

        # Tracked tickers = watchlist ∪ open positions (PLAN §6).
        source = state.market_source
        if source is not None:
            if side == "buy" and ticker not in source.get_tickers():
                await source.add_ticker(ticker)
            elif closed_unwatched:
                await source.remove_ticker(ticker)

    logger.info("Trade: %s %s %s @ %.2f", side, quantity, ticker, price)
    return {
        "ticker": ticker,
        "side": side,
        "quantity": quantity,
        "price": price,
        "realized_pnl": realized_pnl,
        "cash_balance": round(new_cash, 2),
    }
