"""Chat API: POST /api/chat and GET /api/chat/history (PLAN §8)."""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.llm import service

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


@router.post("")
async def post_chat(body: ChatRequest) -> dict:
    return await service.handle_chat(body.message)


@router.get("/history")
async def get_chat_history(limit: int = Query(50, ge=1, le=500)) -> dict:
    return {"messages": service.get_history(limit)}
