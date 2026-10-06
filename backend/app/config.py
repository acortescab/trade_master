"""Application settings loaded from the environment (and the project-root .env)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent

# Real environment variables win over .env values (override=False).
load_dotenv(PROJECT_ROOT / ".env", override=False)


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


@dataclass(frozen=True)
class Settings:
    db_path: str
    static_dir: str
    llm_mock: bool
    openrouter_api_key: str
    massive_api_key: str


def get_settings() -> Settings:
    """Read settings from the environment. Called at use time so tests can monkeypatch env."""
    return Settings(
        db_path=_env("DB_PATH") or str(PROJECT_ROOT / "db" / "trama.db"),
        static_dir=_env("STATIC_DIR") or str(BACKEND_DIR / "static"),
        llm_mock=_env("LLM_MOCK").lower() == "true",
        openrouter_api_key=_env("OPENROUTER_API_KEY"),
        massive_api_key=_env("MASSIVE_API_KEY"),
    )
