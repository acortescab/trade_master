"""Structured-output parsing: valid shapes accepted, malformed responses rejected."""

import json

import pytest

from app.llm.client import LLMError, parse_reply
from app.llm.schema import LLMOutput, TradeAction, WatchlistAction


def test_message_only():
    reply = parse_reply('{"message": "Hi", "actions": []}')
    assert reply.message == "Hi"
    assert reply.actions == []


def test_actions_default_to_empty():
    assert parse_reply('{"message": "Hi"}').actions == []


def test_mixed_actions_in_order():
    reply = parse_reply(
        json.dumps(
            {
                "message": "Done",
                "actions": [
                    {"type": "trade", "ticker": "AAPL", "side": "buy", "quantity": 10},
                    {"type": "watchlist", "ticker": "PYPL", "action": "add"},
                    {"type": "trade", "ticker": "NVDA", "side": "sell", "quantity": 0.5},
                    {"type": "watchlist", "ticker": "V", "action": "remove"},
                ],
            }
        )
    )
    assert [type(a) for a in reply.actions] == [
        TradeAction,
        WatchlistAction,
        TradeAction,
        WatchlistAction,
    ]
    assert reply.actions[0].quantity == 10
    assert reply.actions[2].side == "sell"
    assert reply.actions[3].action == "remove"


def test_code_fence_tolerated():
    reply = parse_reply('```json\n{"message": "Hi", "actions": []}\n```')
    assert reply.message == "Hi"


@pytest.mark.parametrize(
    "content",
    [
        "not json at all",
        "",
        '{"actions": []}',  # missing message
        '{"message": 5, "actions": []}',
        '{"message": "x", "actions": {}}',
        '{"message": "x", "actions": [{"type": "trade", "ticker": "AAPL", "side": "buy", "quantity": 0}]}',
        '{"message": "x", "actions": [{"type": "trade", "ticker": "AAPL", "side": "buy", "quantity": -1}]}',
        '{"message": "x", "actions": [{"type": "trade", "ticker": "AAPL", "side": "hold", "quantity": 1}]}',
        '{"message": "x", "actions": [{"type": "trade", "ticker": "AAPL", "side": "buy"}]}',
        '{"message": "x", "actions": [{"type": "watchlist", "ticker": "AAPL", "action": "delete"}]}',
        '{"message": "x", "actions": [{"type": "option", "ticker": "AAPL"}]}',
        '{"message": "x", "actions": [{"ticker": "AAPL", "side": "buy", "quantity": 1}]}',
    ],
)
def test_malformed_rejected(content):
    with pytest.raises(LLMError, match="couldn't understand"):
        parse_reply(content)


def test_wire_schema_is_strict_friendly():
    schema = LLMOutput.model_json_schema()
    assert schema["required"] == ["message", "actions"]
    assert schema["additionalProperties"] is False
    text = json.dumps(schema)
    for keyword in ("discriminator", "exclusiveMinimum", "default"):
        assert keyword not in text
