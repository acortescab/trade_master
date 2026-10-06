"""Fixtures: the full FastAPI app (lifespan included) on a temp DB with a deterministic source."""

import pytest
from fastapi.testclient import TestClient

from app import main
from app.state import get_state
from tests.services.fakes import DEFAULT_PRICES, FakeSource


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "api.db"))
    monkeypatch.setenv("STATIC_DIR", str(tmp_path / "no-static"))
    monkeypatch.setattr(
        main, "create_market_data_source", lambda cache: FakeSource(cache, DEFAULT_PRICES)
    )
    clients = []

    def _make() -> TestClient:
        client = TestClient(main.create_app())
        client.__enter__()
        clients.append(client)
        return client

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client):
    return make_client()


@pytest.fixture
def source(client) -> FakeSource:
    return get_state().market_source
