"""Portfolio endpoints: valuation, trade execution, value history."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services import ServiceError
from app.services.portfolio import get_history, get_portfolio
from app.services.trading import execute_trade

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


class TradeRequest(BaseModel):
    ticker: str
    side: str
    quantity: float


# Handlers are async so all DB access stays on the event loop thread (one shared connection).
@router.get("")
async def portfolio() -> dict:
    return get_portfolio()


@router.post("/trade")
async def trade(req: TradeRequest) -> dict:
    try:
        return await execute_trade(req.ticker, req.side, req.quantity)
    except ServiceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@router.get("/history")
async def history(hours: float = Query(24, gt=0)) -> dict:
    return {"snapshots": get_history(hours)}
