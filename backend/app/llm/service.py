"""Chat orchestration: context -> LLM (or mock) -> best-effort action execution -> persistence."""

from __future__ import annotations

import logging

from app import db
from app.llm.client import LLMError, call_llm
from app.llm.mock import is_mock_enabled, mock_reply
from app.llm.prompt import build_context, build_messages
from app.llm.schema import ChatReply, TradeAction, WatchlistAction
from app.services import portfolio as portfolio_svc
from app.services import trading as trading_svc
from app.services import watchlist as watchlist_svc
from app.services.errors import ServiceError

logger = logging.getLogger(__name__)

HISTORY_LIMIT = 20


async def execute_actions(actions: list[TradeAction | WatchlistAction]) -> list[dict]:
    """Run actions in order through the shared services; a failure never stops the rest."""
    return [await _execute_action(action) for action in actions]


async def _execute_action(action: TradeAction | WatchlistAction) -> dict:
    raw_ticker = action.ticker.strip().upper()
    if isinstance(action, TradeAction):
        result = {
            "type": "trade",
            "ticker": raw_ticker,
            "side": action.side,
            "quantity": action.quantity,
            "status": "ok",
            "price": None,
            "error": None,
        }
        try:
            fill = await trading_svc.execute_trade(action.ticker, action.side, action.quantity)
            result.update(ticker=fill["ticker"], quantity=fill["quantity"], price=fill["price"])
        except Exception as exc:
            result.update(status="error", error=_error_text(exc, action))
        return result

    result = {
        "type": "watchlist",
        "ticker": raw_ticker,
        "action": action.action,
        "status": "ok",
        "error": None,
    }
    try:
        if action.action == "add":
            item, _created = await watchlist_svc.add_ticker(action.ticker)
            result["ticker"] = item["ticker"]
        else:
            await watchlist_svc.remove_ticker(action.ticker)
    except Exception as exc:
        result.update(status="error", error=_error_text(exc, action))
    return result


def _error_text(exc: Exception, action: TradeAction | WatchlistAction) -> str:
    if isinstance(exc, ServiceError):
        return str(exc)
    logger.exception("Unexpected error executing chat action %r", action)
    return "Internal error while executing this action"


async def _get_reply(message: str, portfolio: dict, watchlist: list[dict], history: list[dict]):
    if is_mock_enabled():
        return mock_reply(message, portfolio.get("total_value") or 0.0)
    messages = build_messages(build_context(portfolio, watchlist), history, message)
    try:
        return await call_llm(messages)
    except LLMError as exc:
        return ChatReply(message=str(exc), actions=[])


async def handle_chat(message: str) -> dict:
    """Process one user chat message and return the stored assistant message (§8 shape)."""
    portfolio = portfolio_svc.get_portfolio()
    watchlist = watchlist_svc.get_watchlist()
    history = db.list_chat_messages(limit=HISTORY_LIMIT)
    db.insert_chat_message("user", message, None)

    reply = await _get_reply(message, portfolio, watchlist, history)
    results = await execute_actions(reply.actions)
    return db.insert_chat_message("assistant", reply.message, results)


def get_history(limit: int = 50) -> list[dict]:
    return db.list_chat_messages(limit=limit)
