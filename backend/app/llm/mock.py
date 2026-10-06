"""Deterministic mock replies for LLM_MOCK=true (PLAN §9 rules table).

Rules are case-insensitive, first match wins, and must match the whole (stripped) message.
Tickers are passed through uppercased but otherwise unvalidated so that invalid symbols fail
in the real execution path exactly as in live mode.
"""

from __future__ import annotations

import re

from app.config import get_settings
from app.llm.schema import ChatReply, TradeAction, WatchlistAction

_QTY = r"(\d+(?:\.\d+)?|\.\d+)"
_TICKER = r"(\S+)"
_END = r"\s*[.!]?"

_TRADE_RE = re.compile(rf"(buy|sell)\s+{_QTY}\s+{_TICKER}{_END}", re.IGNORECASE)
_ADD_RE = re.compile(rf"(?:add|watch)\s+{_TICKER}{_END}", re.IGNORECASE)
_REMOVE_RE = re.compile(rf"(?:remove|unwatch)\s+{_TICKER}{_END}", re.IGNORECASE)


def is_mock_enabled() -> bool:
    return get_settings().llm_mock


def _ticker(raw: str) -> str:
    return raw.strip().rstrip(".!").upper()


def mock_reply(message: str, total_value: float) -> ChatReply:
    text = message.strip()

    if m := _TRADE_RE.fullmatch(text):
        side, qty, ticker = m.group(1).lower(), m.group(2), _ticker(m.group(3))
        verb = "Buying" if side == "buy" else "Selling"
        return ChatReply(
            message=f"{verb} {qty} {ticker}.",
            # model_construct: "buy 0 X" must fail in the real execution path, not here.
            actions=[
                TradeAction.model_construct(
                    type="trade", ticker=ticker, side=side, quantity=float(qty)
                )
            ],
        )
    if m := _ADD_RE.fullmatch(text):
        ticker = _ticker(m.group(1))
        return ChatReply(
            message=f"Adding {ticker} to your watchlist.",
            actions=[WatchlistAction(type="watchlist", ticker=ticker, action="add")],
        )
    if m := _REMOVE_RE.fullmatch(text):
        ticker = _ticker(m.group(1))
        return ChatReply(
            message=f"Removing {ticker} from your watchlist.",
            actions=[WatchlistAction(type="watchlist", ticker=ticker, action="remove")],
        )
    return ChatReply(
        message=f"Mock TraMa here. Your portfolio is worth ${total_value:,.2f}.", actions=[]
    )
