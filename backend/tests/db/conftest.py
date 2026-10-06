"""Fixtures for DB tests: a fresh, initialized database per test."""

import pytest

from app import db


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "data" / "trama.db")


@pytest.fixture
def conn(db_path):
    db.init_db(db_path)
    yield db.get_connection()
    db.close_db()
