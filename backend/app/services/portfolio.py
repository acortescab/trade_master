"""Portfolio valuation and value history."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app import db
from app.state import get_state


def get_portfolio() -> dict:
    """§8 GET /api/portfolio shape. Unpriced positions are valued at avg_cost with null P&L."""
    cache = get_state().price_cache
    cash = db.get_cash()
    total_value = cash
    unrealized_total = 0.0
    positions = []
    for p in db.list_positions():
        price = cache.get_price(p.ticker)
        if price is None:
            total_value += p.quantity * p.avg_cost
            positions.append(
                {
                    "ticker": p.ticker,
                    "quantity": p.quantity,
                    "avg_cost": round(p.avg_cost, 4),
                    "current_price": None,
                    "market_value": None,
                    "unrealized_pnl": None,
                    "unrealized_pnl_pct": None,
                }
            )
            continue
        market_value = p.quantity * price
        pnl = market_value - p.quantity * p.avg_cost
        pnl_pct = (price - p.avg_cost) / p.avg_cost * 100 if p.avg_cost else 0.0
        total_value += market_value
        unrealized_total += pnl
        positions.append(
            {
                "ticker": p.ticker,
                "quantity": p.quantity,
                "avg_cost": round(p.avg_cost, 4),
                "current_price": price,
                "market_value": round(market_value, 2),
                "unrealized_pnl": round(pnl, 2),
                "unrealized_pnl_pct": round(pnl_pct, 2),
            }
        )
    return {
        "cash_balance": round(cash, 2),
        "total_value": round(total_value, 2),
        "unrealized_pnl": round(unrealized_total, 2),
        "realized_pnl": round(db.realized_pnl_total(), 2),
        "positions": positions,
    }


def get_history(hours: float = 24) -> list[dict]:
    """Snapshots recorded in the last `hours` hours, oldest first."""
    since = datetime.now(UTC) - timedelta(hours=hours)
    return db.list_snapshots(since.strftime("%Y-%m-%dT%H:%M:%SZ"))
