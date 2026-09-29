"""Tests for session_open tracking."""

from app.market.cache import PriceCache
from app.market.models import PriceUpdate


class TestSessionOpen:
    """session_open is the first price recorded per ticker."""

    def test_recorded_once(self):
        cache = PriceCache()
        cache.update("AAPL", 190.00)
        cache.update("AAPL", 195.00)
        assert cache.get("AAPL").session_open == 190.00

    def test_per_ticker(self):
        cache = PriceCache()
        cache.update("AAPL", 190.00)
        cache.update("GOOGL", 175.00)
        assert cache.get("GOOGL").session_open == 175.00

    def test_survives_remove(self):
        cache = PriceCache()
        cache.update("AAPL", 190.00)
        cache.remove("AAPL")
        cache.update("AAPL", 200.00)
        assert cache.get("AAPL").session_open == 190.00

    def test_to_dict_includes_session_open(self):
        cache = PriceCache()
        cache.update("AAPL", 190.00)
        d = cache.update("AAPL", 191.00).to_dict()
        assert d["session_open"] == 190.00

    def test_to_dict_defaults_to_price(self):
        u = PriceUpdate(ticker="AAPL", price=191.0, previous_price=190.5)
        assert u.to_dict()["session_open"] == 191.0
