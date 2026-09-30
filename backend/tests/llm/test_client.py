"""LiteLLM client: call parameters, missing key, timeout, API errors, bad content."""

import asyncio

import pytest

from app.llm import client
from app.llm.client import EXTRA_BODY, MODEL, LLMError, call_llm
from app.llm.schema import LLMOutput

MESSAGES = [{"role": "user", "content": "hi"}]


async def test_valid_call_uses_cerebras_structured_output(llm_returns):
    calls = llm_returns('{"message": "Hello", "actions": []}')
    reply = await call_llm(MESSAGES)
    assert reply.message == "Hello"
    [kwargs] = calls
    assert kwargs["model"] == MODEL == "openrouter/openai/gpt-oss-120b"
    assert kwargs["extra_body"] == EXTRA_BODY == {"provider": {"order": ["cerebras"]}}
    assert kwargs["response_format"] is LLMOutput
    assert kwargs["reasoning_effort"] == "low"
    assert kwargs["messages"] == MESSAGES
    assert kwargs["api_key"] == "test-key"


@pytest.mark.parametrize("value", [None, "", "   "])
async def test_missing_key(monkeypatch, llm_returns, value):
    calls = llm_returns('{"message": "x", "actions": []}')
    if value is None:
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    else:
        monkeypatch.setenv("OPENROUTER_API_KEY", value)
    with pytest.raises(LLMError, match="OPENROUTER_API_KEY is not configured"):
        await call_llm(MESSAGES)
    assert calls == []


async def test_timeout(monkeypatch):
    async def _slow(**kwargs):
        await asyncio.sleep(5)

    monkeypatch.setattr(client, "_acompletion", _slow)
    monkeypatch.setattr(client, "TIMEOUT_SECONDS", 0.01)
    with pytest.raises(LLMError, match="timed out"):
        await call_llm(MESSAGES)


async def test_provider_timeout_exception(monkeypatch):
    class APITimeoutError(Exception):
        pass

    async def _raise(**kwargs):
        raise APITimeoutError("upstream")

    monkeypatch.setattr(client, "_acompletion", _raise)
    with pytest.raises(LLMError, match="timed out"):
        await call_llm(MESSAGES)


async def test_invalid_key(monkeypatch):
    class AuthenticationError(Exception):
        pass

    async def _raise(**kwargs):
        raise AuthenticationError("401")

    monkeypatch.setattr(client, "_acompletion", _raise)
    with pytest.raises(LLMError, match="API key was rejected"):
        await call_llm(MESSAGES)


async def test_generic_api_error(monkeypatch):
    async def _raise(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(client, "_acompletion", _raise)
    with pytest.raises(LLMError, match="unavailable"):
        await call_llm(MESSAGES)


@pytest.mark.parametrize("content", [None, ""])
async def test_empty_content(llm_returns, content):
    llm_returns(content)
    with pytest.raises(LLMError, match="empty response"):
        await call_llm(MESSAGES)


async def test_schema_failure(llm_returns):
    llm_returns('{"message": "x", "actions": [{"type": "trade"}]}')
    with pytest.raises(LLMError, match="nothing was executed"):
        await call_llm(MESSAGES)
