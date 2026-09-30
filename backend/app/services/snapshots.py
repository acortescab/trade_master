"""Background task recording total portfolio value every 30 seconds (for the P&L chart)."""

from __future__ import annotations

import asyncio
import logging

from app import db

from .portfolio import get_portfolio

logger = logging.getLogger(__name__)

SNAPSHOT_INTERVAL = 30.0


def record_snapshot() -> float:
    """Persist the current total value and return it."""
    total_value = get_portfolio()["total_value"]
    db.insert_snapshot(total_value)
    return total_value


async def snapshot_loop(interval: float = SNAPSHOT_INTERVAL) -> None:
    """Record a snapshot immediately, then every `interval` seconds until cancelled."""
    while True:
        try:
            record_snapshot()
        except Exception:
            logger.exception("Portfolio snapshot failed")
        await asyncio.sleep(interval)
