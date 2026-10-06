"""Watchlist endpoints."""

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app.services import ServiceError, WatchlistNotFound
from app.services import watchlist as watchlist_service

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


class AddTickerRequest(BaseModel):
    ticker: str


@router.get("")
async def get_watchlist() -> dict:
    return {"tickers": watchlist_service.get_watchlist()}


@router.post("", status_code=201)
async def add_ticker(req: AddTickerRequest, response: Response) -> dict:
    try:
        item, created = await watchlist_service.add_ticker(req.ticker)
    except ServiceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    if not created:
        response.status_code = 200
    return item


@router.delete("/{ticker}", status_code=204)
async def remove_ticker(ticker: str) -> Response:
    try:
        await watchlist_service.remove_ticker(ticker)
    except WatchlistNotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from None
    except ServiceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    return Response(status_code=204)
