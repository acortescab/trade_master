"""Fixtures: fresh SQLite + AppState with deterministic prices; env pinned; no network ever."""

import pytest

from app import db
from app.llm import client
from app.services.watchlist import tracked_tickers
from app.state import reset_state
from tests.services.fakes import DEFAULT_PRICES, FakeSource


@pytest.fixture(autouse=True)
def llm_env(monkeypatch):
    """Default: live mode with a fake key. The real LiteLLM call is always blocked."""
    monkeypatch.setenv("LLM_MOCK", "false")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    async def _no_network(**kwargs):
        raise AssertionError("tests must patch app.llm.client._acompletion")

    monkeypatch.setattr(client, "_acompletion", _no_network)


@pytest.fixture
async def source(tmp_path):
    db.init_db(str(tmp_path / "test.db"))
    state = reset_state()
    fake = FakeSource(state.price_cache, DEFAULT_PRICES)
    state.market_source = fake
    await fake.start(tracked_tickers())
    yield fake
    db.close_db()
    reset_state()


class FakeResponse:
    """Minimal stand-in for a LiteLLM ModelResponse."""

    def __init__(self, content):
        message = type("Message", (), {"content": content})()
        self.choices = [type("Choice", (), {"message": message})()]


@pytest.fixture
def llm_returns(monkeypatch):
    """Patch the LiteLLM call to return the given content; records the call kwargs."""
    calls: list[dict] = []

    def _install(content):
        async def _fake(**kwargs):
            calls.append(kwargs)
            return FakeResponse(content)

        monkeypatch.setattr(client, "_acompletion", _fake)
        return calls

    return _install
