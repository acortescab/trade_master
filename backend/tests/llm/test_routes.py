"""/api/chat routes: status codes and §8 response shapes."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.chat import router


@pytest.fixture
def http(source, monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_post_chat_shape(http):
    resp = http.post("/api/chat", json={"message": "buy 1 AAPL"})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"id", "role", "message", "actions", "created_at"}
    assert body["role"] == "assistant"
    assert body["message"] == "Buying 1 AAPL."
    assert body["actions"][0]["status"] == "ok"
    assert body["created_at"].endswith("Z")


def test_post_chat_failure_is_still_200(http, monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "false")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    resp = http.post("/api/chat", json={"message": "hi"})
    assert resp.status_code == 200
    assert resp.json()["actions"] == []


@pytest.mark.parametrize("payload", [{}, {"message": ""}, {"message": 5}, {"msg": "hi"}])
def test_post_chat_malformed_body(http, payload):
    assert http.post("/api/chat", json=payload).status_code == 422


def test_history_shape_and_limit(http):
    http.post("/api/chat", json={"message": "add PYPL"})
    http.post("/api/chat", json={"message": "hello"})

    resp = http.get("/api/chat/history")
    assert resp.status_code == 200
    messages = resp.json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]
    assert messages[0]["message"] == "add PYPL"
    assert messages[0]["actions"] is None
    assert messages[1]["actions"][0]["type"] == "watchlist"
    for m in messages:
        assert set(m) == {"id", "role", "message", "actions", "created_at"}

    last_two = http.get("/api/chat/history?limit=2").json()["messages"]
    assert [m["message"] for m in last_two] == ["hello", messages[3]["message"]]
    assert http.get("/api/chat/history?limit=0").status_code == 422
