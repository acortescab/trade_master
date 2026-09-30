"""Fixtures: a fresh SQLite file and AppState with a deterministic FakeSource per test."""

import pytest

from app import db
from app.services.watchlist import tracked_tickers
from app.state import reset_state

from .fakes import DEFAULT_PRICES, FakeSource


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
