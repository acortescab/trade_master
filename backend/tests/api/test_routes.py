"""HTTP status codes and response shapes (PLAN §8)."""

import json

import pytest
from fastapi.testclient import TestClient

from app import main
from app.state import get_state


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_lifespan_starts_source_with_tracked_tickers(client, source):
    assert source.started
    assert len(source.get_tickers()) == 10


def test_lifespan_records_initial_snapshot(client):
    snaps = client.get("/api/portfolio/history").json()["snapshots"]
    assert snaps and snaps[0]["total_value"] == 10000.0
    assert set(snaps[0]) == {"recorded_at", "total_value"}


@pytest.mark.usefixtures("make_client")  # applies env + fake source patches
def test_shutdown_stops_source():
    with TestClient(main.create_app()):
        src = get_state().market_source
    assert src.stopped
    assert get_state().market_source is None


class TestPortfolio:
    def test_get_portfolio_fresh(self, client):
        r = client.get("/api/portfolio")
        assert r.status_code == 200
        assert r.json() == {
            "cash_balance": 10000.0,
            "total_value": 10000.0,
            "unrealized_pnl": 0.0,
            "realized_pnl": 0.0,
            "positions": [],
        }

    def test_buy(self, client):
        r = client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "buy", "quantity": 10})
        assert r.status_code == 200
        assert r.json() == {
            "ticker": "AAPL",
            "side": "buy",
            "quantity": 10,
            "price": 190.0,
            "realized_pnl": None,
            "cash_balance": 8100.0,
        }
        p = client.get("/api/portfolio").json()
        assert p["positions"][0]["ticker"] == "AAPL"
        assert set(p["positions"][0]) == {
            "ticker", "quantity", "avg_cost", "current_price",
            "market_value", "unrealized_pnl", "unrealized_pnl_pct",
        }

    def test_sell_returns_realized_pnl(self, client, source):
        client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "buy", "quantity": 10})
        source.set_price("AAPL", 195.0)
        r = client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "sell", "quantity": 10})
        assert r.status_code == 200
        assert r.json()["realized_pnl"] == 50.0
        p = client.get("/api/portfolio").json()
        assert p["positions"] == []
        assert p["realized_pnl"] == 50.0

    def test_insufficient_cash_400(self, client):
        r = client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "buy", "quantity": 1000})
        assert r.status_code == 400
        assert r.json() == {"detail": "Insufficient cash: need $190000.00, have $10000.00"}

    def test_oversell_400(self, client):
        r = client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "sell", "quantity": 1})
        assert r.status_code == 400
        assert "Insufficient shares" in r.json()["detail"]

    def test_no_price_400(self, client):
        r = client.post("/api/portfolio/trade", json={"ticker": "ZZZZ", "side": "buy", "quantity": 1})
        assert r.status_code == 400
        assert r.json()["detail"] == "No price available for ZZZZ"

    def test_invalid_ticker_side_quantity_400(self, client):
        for body in (
            {"ticker": "12", "side": "buy", "quantity": 1},
            {"ticker": "AAPL", "side": "hold", "quantity": 1},
            {"ticker": "AAPL", "side": "buy", "quantity": 0},
            {"ticker": "AAPL", "side": "buy", "quantity": -5},
        ):
            r = client.post("/api/portfolio/trade", json=body)
            assert r.status_code == 400, body
            assert isinstance(r.json()["detail"], str)

    def test_malformed_body_422(self, client):
        assert client.post("/api/portfolio/trade", json={"ticker": "AAPL"}).status_code == 422
        r = client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "buy", "quantity": "x"})
        assert r.status_code == 422

    def test_history_param(self, client):
        assert client.get("/api/portfolio/history?hours=1").status_code == 200
        assert client.get("/api/portfolio/history?hours=0").status_code == 422


class TestWatchlist:
    def test_get(self, client):
        r = client.get("/api/watchlist")
        assert r.status_code == 200
        tickers = r.json()["tickers"]
        assert len(tickers) == 10
        assert tickers[0] == {"ticker": "AAPL", "price": 190.0, "session_open": 190.0}

    def test_add_201_then_idempotent_200(self, client):
        r = client.post("/api/watchlist", json={"ticker": "pypl"})
        assert r.status_code == 201
        assert r.json() == {"ticker": "PYPL", "price": 60.0, "session_open": 60.0}
        r = client.post("/api/watchlist", json={"ticker": "PYPL"})
        assert r.status_code == 200
        assert r.json()["ticker"] == "PYPL"
        assert [t["ticker"] for t in client.get("/api/watchlist").json()["tickers"]].count("PYPL") == 1

    def test_add_unpriced_returns_nulls(self, client):
        r = client.post("/api/watchlist", json={"ticker": "ZZZZ"})
        assert r.status_code == 201
        assert r.json() == {"ticker": "ZZZZ", "price": None, "session_open": None}

    def test_add_invalid_400(self, client):
        r = client.post("/api/watchlist", json={"ticker": "bad ticker"})
        assert r.status_code == 400
        assert r.json() == {"detail": "Invalid ticker symbol"}

    def test_add_malformed_422(self, client):
        assert client.post("/api/watchlist", json={}).status_code == 422

    def test_delete_204_then_404(self, client):
        r = client.delete("/api/watchlist/NFLX")
        assert r.status_code == 204
        assert r.content == b""
        r = client.delete("/api/watchlist/NFLX")
        assert r.status_code == 404
        assert "detail" in r.json()

    def test_delete_keeps_pricing_open_position(self, client, source):
        client.post("/api/portfolio/trade", json={"ticker": "AAPL", "side": "buy", "quantity": 1})
        assert client.delete("/api/watchlist/aapl").status_code == 204
        assert "AAPL" in source.get_tickers()
        pos = client.get("/api/portfolio").json()["positions"][0]
        assert pos["current_price"] == 190.0


def test_sse_stream_route_is_registered(client):
    paths = {getattr(r, "path", None) for r in client.app.routes}
    assert "/api/stream/prices" in paths


async def test_sse_generator_emits_retry_then_all_tickers():
    from app.market import PriceCache
    from app.market.stream import _generate_events

    class Req:
        client = None

        async def is_disconnected(self):
            return False

    cache = PriceCache()
    cache.update("AAPL", 190.0)
    gen = _generate_events(cache, Req(), interval=0)
    assert await gen.__anext__() == "retry: 1000\n\n"
    event = await gen.__anext__()
    payload = json.loads(event.removeprefix("data: "))
    assert payload["AAPL"]["session_open"] == 190.0
    await gen.aclose()


def test_each_app_streams_from_its_own_cache(make_client):
    make_client()
    second = make_client()
    stream_routes = [r for r in second.app.routes if getattr(r, "path", "") == "/api/stream/prices"]
    assert len(stream_routes) == 1


def test_static_mount_after_api(tmp_path, monkeypatch, make_client):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<html>TraMa</html>")
    monkeypatch.setenv("STATIC_DIR", str(static))
    c = make_client()
    assert "TraMa" in c.get("/").text
    assert c.get("/api/health").json() == {"status": "ok"}
    assert c.get("/api/watchlist").status_code == 200
