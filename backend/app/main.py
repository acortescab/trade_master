"""FastAPI application: API routers, SSE stream, background tasks, static frontend."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app import db
from app.api import health, portfolio, watchlist
from app.config import get_settings
from app.market import create_market_data_source, create_stream_router
from app.services.snapshots import snapshot_loop
from app.services.watchlist import tracked_tickers
from app.state import get_state, reset_state

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    db.init_db(settings.db_path)
    logger.info("Database ready at %s", settings.db_path)

    state = get_state()
    source = create_market_data_source(state.price_cache)
    state.market_source = source
    await source.start(tracked_tickers())
    snapshot_task = asyncio.create_task(snapshot_loop(), name="portfolio-snapshots")

    try:
        yield
    finally:
        snapshot_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await snapshot_task
        await source.stop()
        state.market_source = None
        db.close_db()


def _chat_router():
    """The chat router is owned by llm-engineer; tolerate it not existing yet."""
    try:
        from app.api import chat
    except ModuleNotFoundError as e:
        if e.name != "app.api.chat":
            raise
        logger.warning("app.api.chat not found; /api/chat is unavailable")
        return None
    return chat.router


def create_app() -> FastAPI:
    state = reset_state()
    app = FastAPI(title="TraMa", lifespan=lifespan)

    # All /api routers must be registered before the static mount at "/".
    app.include_router(health.router)
    app.include_router(portfolio.router)
    app.include_router(watchlist.router)
    app.include_router(create_stream_router(state.price_cache))
    chat_router = _chat_router()
    if chat_router is not None:
        app.include_router(chat_router)

    static_dir = Path(get_settings().static_dir)
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
        logger.info("Serving frontend from %s", static_dir)
    else:
        logger.info("No frontend build at %s; serving API only", static_dir)

    return app


app = create_app()
