"""LLM_MOCK rules (PLAN §9): case-insensitive, first match wins, whole message."""

import pytest

from app.llm.mock import is_mock_enabled, mock_reply
from app.llm.schema import TradeAction, WatchlistAction


@pytest.mark.parametrize(
    ("text", "message", "side", "qty", "ticker"),
    [
        ("buy 1 AAPL", "Buying 1 AAPL.", "buy", 1.0, "AAPL"),
        ("BUY 10 nvda", "Buying 10 NVDA.", "buy", 10.0, "NVDA"),
        ("  Buy 2.5 brk.b.  ", "Buying 2.5 BRK.B.", "buy", 2.5, "BRK.B"),
        ("sell 3 TSLA", "Selling 3 TSLA.", "sell", 3.0, "TSLA"),
        ("Sell 0.25 msft!", "Selling 0.25 MSFT.", "sell", 0.25, "MSFT"),
    ],
)
def test_trade_rules(text, message, side, qty, ticker):
    reply = mock_reply(text, 10000.0)
    assert reply.message == message
    assert len(reply.actions) == 1
    action = reply.actions[0]
    assert isinstance(action, TradeAction)
    assert (action.type, action.side, action.quantity, action.ticker) == (
        "trade",
        side,
        qty,
        ticker,
    )


def test_zero_quantity_is_left_to_execution_path():
    reply = mock_reply("buy 0 AAPL", 10000.0)
    assert reply.actions[0].quantity == 0.0


@pytest.mark.parametrize("verb", ["add", "ADD", "watch", "Watch"])
def test_add_rules(verb):
    reply = mock_reply(f"{verb} pypl", 10000.0)
    assert reply.message == "Adding PYPL to your watchlist."
    [action] = reply.actions
    assert isinstance(action, WatchlistAction)
    assert (action.type, action.ticker, action.action) == ("watchlist", "PYPL", "add")


@pytest.mark.parametrize("verb", ["remove", "REMOVE", "unwatch", "Unwatch"])
def test_remove_rules(verb):
    reply = mock_reply(f"{verb} NFLX", 10000.0)
    assert reply.message == "Removing NFLX from your watchlist."
    [action] = reply.actions
    assert (action.type, action.ticker, action.action) == ("watchlist", "NFLX", "remove")


def test_invalid_ticker_passes_through_for_real_validation():
    reply = mock_reply("add 123bad", 10000.0)
    assert reply.actions[0].ticker == "123BAD"


@pytest.mark.parametrize(
    "text",
    [
        "hello",
        "how is my portfolio?",
        "buy AAPL",  # no quantity
        "buy -5 AAPL",
        "please buy 1 AAPL now",
        "add",
        "",
    ],
)
def test_fallback(text):
    reply = mock_reply(text, 10000.0)
    assert reply.message == "Mock TraMa here. Your portfolio is worth $10,000.00."
    assert reply.actions == []


def test_fallback_formats_total_value():
    assert mock_reply("hi", 1234567.891).message.endswith("worth $1,234,567.89.")


@pytest.mark.parametrize(
    ("value", "expected"), [("true", True), ("TRUE", True), ("false", False), ("", False)]
)
def test_is_mock_enabled(monkeypatch, value, expected):
    monkeypatch.setenv("LLM_MOCK", value)
    assert is_mock_enabled() is expected
