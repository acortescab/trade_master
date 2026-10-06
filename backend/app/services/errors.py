"""Business-rule errors raised by services. Routers map these to HTTP status codes."""


class ServiceError(Exception):
    """A business-rule failure with a human-readable message (HTTP 400)."""


class TradeError(ServiceError):
    """A trade was rejected (invalid input, insufficient cash/shares, no price)."""


class WatchlistError(ServiceError):
    """A watchlist change was rejected."""


class WatchlistNotFound(WatchlistError):  # noqa: N818 - name fixed by TEAM_CONTRACTS §5
    """The ticker is not on the watchlist (HTTP 404)."""
