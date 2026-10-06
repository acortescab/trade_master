"""LiteLLM -> OpenRouter -> Cerebras client (see the `cerebras` skill)."""

from __future__ import annotations

import asyncio
import logging
import os

from pydantic import ValidationError

from app.config import get_settings
from app.llm.schema import ChatReply, LLMOutput

logger = logging.getLogger(__name__)

MODEL = "openrouter/openai/gpt-oss-120b"
EXTRA_BODY = {"provider": {"order": ["cerebras"]}}
TIMEOUT_SECONDS = 30.0


class LLMError(Exception):
    """The LLM could not produce a usable reply. ``str()`` is safe to show to the user."""


async def _acompletion(**kwargs):
    """Lazy litellm import: keeps app startup fast; tests patch this function."""
    # Use the bundled model cost map instead of fetching it from GitHub at import time.
    os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
    from litellm import acompletion

    return await acompletion(**kwargs)


def get_api_key() -> str | None:
    return get_settings().openrouter_api_key or None


async def call_llm(messages: list[dict]) -> ChatReply:
    """Call the model with structured output and return the validated reply.

    Raises LLMError for a missing key, timeout, API failure, or a response failing validation.
    """
    api_key = get_api_key()
    if not api_key:
        raise LLMError("The AI assistant is unavailable: OPENROUTER_API_KEY is not configured.")

    try:
        response = await asyncio.wait_for(
            _acompletion(
                model=MODEL,
                messages=messages,
                response_format=LLMOutput,
                reasoning_effort="low",
                extra_body=EXTRA_BODY,
                api_key=api_key,
                timeout=TIMEOUT_SECONDS,
            ),
            timeout=TIMEOUT_SECONDS,
        )
    except TimeoutError as exc:
        logger.error("LLM call timed out after %ss", TIMEOUT_SECONDS)
        raise LLMError("The AI assistant timed out. Please try again.") from exc
    except Exception as exc:
        logger.exception("LLM call failed")
        if "timeout" in type(exc).__name__.lower():
            raise LLMError("The AI assistant timed out. Please try again.") from exc
        if "auth" in type(exc).__name__.lower():
            raise LLMError(
                "The AI assistant is unavailable: the OpenRouter API key was rejected."
            ) from exc
        raise LLMError(f"The AI assistant is unavailable: {type(exc).__name__}.") from exc

    try:
        content = response.choices[0].message.content
    except (AttributeError, IndexError, KeyError, TypeError) as exc:
        logger.error("LLM response had no content: %r", response)
        raise LLMError("The AI assistant returned an empty response. Please try again.") from exc
    if not content:
        logger.error("LLM response had empty content: %r", response)
        raise LLMError("The AI assistant returned an empty response. Please try again.")

    return parse_reply(content)


def parse_reply(content: str) -> ChatReply:
    """Validate raw model output; tolerates a surrounding ```json fence. Raises LLMError."""
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rsplit("```", 1)[0]
    try:
        return ChatReply.model_validate_json(text)
    except ValidationError as exc:
        logger.error("LLM response failed schema validation: %s\nRaw content: %s", exc, content)
        raise LLMError(
            "The AI assistant returned a response I couldn't understand, so nothing was executed. "
            "Please try again."
        ) from exc
