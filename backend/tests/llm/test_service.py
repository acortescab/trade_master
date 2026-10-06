"""handle_chat end to end against a real SQLite DB and services (LLM call patched)."""

import json

import pytest

from app import db
from app.llm import service
from app.llm.prompt import SYSTEM_PROMPT, build_context
from app.llm.schema import TradeAction, WatchlistAction
from app.services import portfolio as portfolio_svc


async def test_mixed_success_and_failure_is_best_effort(source, llm_returns):
    llm_returns(
        json.dumps(
            {
                "message": "On it.",
                "actions": [
                    {"type": "trade", "ticker": "aapl", "side": "buy", "quantity": 10},
                    {"type": "trade", "ticker": "NVDA", "side": "buy", "quantity": 1000},
                    {"type": "watchlist", "ticker": "123", "action": "add"},
                    {"type": "watchlist", "ticker": "PYPL", "action": "add"},
                    {"type": "trade", "ticker": "TSLA", "side": "sell", "quantity": 1},
                    {"type": "watchlist", "ticker": "ZZZZ", "action": "remove"},
                ],
            }
        )
    )
    result = await service.handle_chat("do stuff")

    assert result["role"] == "assistant"
    assert result["message"] == "On it."
    assert set(result) == {"id", "role", "message", "actions", "created_at"}
    a = result["actions"]
    assert a[0] == {
        "type": "trade",
        "ticker": "AAPL",
        "side": "buy",
        "quantity": 10,
        "status": "ok",
        "price": 190.0,
        "error": None,
    }
    assert a[1]["status"] == "error" and a[1]["error"].startswith("Insufficient cash")
    assert a[1]["price"] is None
    assert a[2] == {
        "type": "watchlist",
        "ticker": "123",
        "action": "add",
        "status": "error",
        "error": "Invalid ticker symbol",
    }
    assert a[3] == {
        "type": "watchlist",
        "ticker": "PYPL",
        "action": "add",
        "status": "ok",
        "error": None,
    }
    assert a[4]["status"] == "error" and "Insufficient shares" in a[4]["error"]
    assert a[5]["status"] == "error" and "not on the watchlist" in a[5]["error"]

    # Side effects of the successful actions only.
    assert db.get_position("AAPL").quantity == 10
    assert db.get_position("NVDA") is None
    assert "PYPL" in db.list_watchlist()
    assert db.get_cash() == pytest.approx(10000 - 1900)


async def test_messages_persisted_with_actions(source, llm_returns):
    llm_returns(
        '{"message": "Added.", "actions": [{"type": "watchlist", "ticker": "PYPL", "action": "add"}]}'
    )
    result = await service.handle_chat("add paypal")
    history = service.get_history()
    assert [m["role"] for m in history] == ["user", "assistant"]
    assert history[0]["message"] == "add paypal"
    assert history[0]["actions"] is None
    assert history[1] == result


async def test_prompt_includes_context_and_history_with_action_results(source, llm_returns):
    llm_returns(
        '{"message": "Bought.", "actions": [{"type": "trade", "ticker": "AAPL", "side": "buy", "quantity": 1000}]}'
    )
    await service.handle_chat("buy lots of apple")

    calls = llm_returns('{"message": "ok", "actions": []}')
    await service.handle_chat("what happened?")
    messages = calls[-1]["messages"]

    assert messages[0] == {"role": "system", "content": SYSTEM_PROMPT}
    assert messages[1]["role"] == "system"
    assert "Cash: $10,000.00" in messages[1]["content"]
    assert "AAPL | $190.00" in messages[1]["content"]
    assert messages[2] == {"role": "user", "content": "buy lots of apple"}
    assert messages[3]["role"] == "assistant"
    assert messages[3]["content"].startswith("Bought.\n[Action results: ")
    assert "Insufficient cash" in messages[3]["content"]
    assert messages[-1] == {"role": "user", "content": "what happened?"}


async def test_history_limited_to_20(source, llm_returns):
    for i in range(15):
        db.insert_chat_message("user", f"u{i}", None)
        db.insert_chat_message("assistant", f"a{i}", [])
    calls = llm_returns('{"message": "ok", "actions": []}')
    await service.handle_chat("latest")
    messages = calls[0]["messages"]
    assert len(messages) == 2 + 20 + 1
    assert messages[2]["content"] == "u5"


async def test_missing_key_returns_message_and_stores_it(source, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    result = await service.handle_chat("buy 1 AAPL")
    assert "OPENROUTER_API_KEY is not configured" in result["message"]
    assert result["actions"] == []
    assert db.get_position("AAPL") is None
    assert [m["role"] for m in service.get_history()] == ["user", "assistant"]


async def test_malformed_response_executes_nothing(source, llm_returns):
    llm_returns(
        '{"message": "x", "actions": [{"type": "trade", "ticker": "AAPL", "side": "buy", "quantity": 0}, {"type": "watchlist", "ticker": "PYPL", "action": "add"}]}'
    )
    result = await service.handle_chat("go")
    assert result["actions"] == []
    assert "PYPL" not in db.list_watchlist()
    assert db.get_position("AAPL") is None


async def test_mock_mode_buy_goes_through_real_path(source, monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    result = await service.handle_chat("buy 1 AAPL")
    assert result["message"] == "Buying 1 AAPL."
    assert result["actions"] == [
        {
            "type": "trade",
            "ticker": "AAPL",
            "side": "buy",
            "quantity": 1,
            "status": "ok",
            "price": 190.0,
            "error": None,
        }
    ]
    assert db.get_position("AAPL").quantity == 1


async def test_mock_mode_validation_errors(source, monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")
    sell = await service.handle_chat("sell 5 AAPL")
    assert sell["actions"][0]["status"] == "error"
    zero = await service.handle_chat("buy 0 AAPL")
    assert zero["actions"][0]["error"] == "Quantity must be greater than 0"
    bad = await service.handle_chat("add 123")
    assert bad["actions"][0]["error"] == "Invalid ticker symbol"


async def test_mock_mode_add_remove_and_fallback(source, monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")
    added = await service.handle_chat("watch pypl")
    assert added["actions"][0]["status"] == "ok"
    assert "PYPL" in db.list_watchlist()
    removed = await service.handle_chat("unwatch PYPL")
    assert removed["actions"][0]["status"] == "ok"
    assert "PYPL" not in db.list_watchlist()
    other = await service.handle_chat("hello")
    assert other["message"] == "Mock TraMa here. Your portfolio is worth $10,000.00."
    assert other["actions"] == []


async def test_unexpected_exception_is_contained(source, monkeypatch):
    async def _boom(*args, **kwargs):
        raise RuntimeError("db exploded")

    monkeypatch.setattr(service.trading_svc, "execute_trade", _boom)
    results = await service.execute_actions(
        [
            TradeAction(type="trade", ticker="AAPL", side="buy", quantity=1),
            WatchlistAction(type="watchlist", ticker="PYPL", action="add"),
        ]
    )
    assert results[0]["status"] == "error"
    assert results[0]["error"] == "Internal error while executing this action"
    assert results[1]["status"] == "ok"


async def test_build_context_handles_unpriced(source):
    await source.add_ticker("XYZ")  # no price in FakeSource
    db.upsert_position("XYZ", 2, 50.0)
    db.add_watchlist("XYZ")
    text = build_context(
        portfolio_svc.get_portfolio(), [{"ticker": "XYZ", "price": None, "session_open": None}]
    )
    assert "XYZ | 2 | $50.00 | n/a" in text
    assert "- XYZ | n/a | n/a" in text
