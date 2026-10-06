"""Structured-output schema for the TraMa chat assistant.

Two layers:
- ``LLMOutput`` is the *wire* schema sent as ``response_format``. It is kept minimal (no defaults,
  numeric constraints or discriminator keywords) so provider strict-mode JSON schema accepts it.
- ``ChatReply`` is the *validation* model. The raw JSON returned by the model is validated against
  it; any failure means the whole response is rejected and nothing is executed (PLAN §9).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# --- Wire schema (response_format) -----------------------------------------------------------


class WireTradeAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["trade"]
    ticker: str
    side: Literal["buy", "sell"]
    quantity: float


class WireWatchlistAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["watchlist"]
    ticker: str
    action: Literal["add", "remove"]


class LLMOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str
    actions: list[WireTradeAction | WireWatchlistAction]


# --- Validation schema -----------------------------------------------------------------------


class TradeAction(BaseModel):
    type: Literal["trade"]
    ticker: str = Field(min_length=1)
    side: Literal["buy", "sell"]
    quantity: float = Field(gt=0)


class WatchlistAction(BaseModel):
    type: Literal["watchlist"]
    ticker: str = Field(min_length=1)
    action: Literal["add", "remove"]


Action = Annotated[TradeAction | WatchlistAction, Field(discriminator="type")]


class ChatReply(BaseModel):
    message: str
    actions: list[Action] = Field(default_factory=list)
