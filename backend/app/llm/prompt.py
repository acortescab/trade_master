"""Prompt construction: system prompt, portfolio context and conversation history."""

from __future__ import annotations

import json

SYSTEM_PROMPT = """You are TraMa, an AI trading assistant inside a simulated trading workstation.
The user trades a virtual portfolio with fake money; market orders fill instantly at the current price.

Your job:
- Analyze portfolio composition, risk concentration and P&L using the portfolio context provided.
- Suggest trades with brief reasoning.
- Execute trades when the user asks for them or agrees to your suggestion, by adding actions.
- Convert dollar-amount requests (e.g. "buy $500 of NVDA") into share quantities using the current
  price from the context: quantity = dollars / price, rounded DOWN to 4 decimal places.
- Manage the watchlist proactively (add tickers the user is interested in, remove ones they drop).
- Be concise and data-driven. Use numbers from the context; never invent prices.

Response format - always reply with a JSON object:
{"message": "<your reply to the user>", "actions": [ ... ]}
Each action is one of:
  {"type": "trade", "ticker": "AAPL", "side": "buy" | "sell", "quantity": <number > 0>}
  {"type": "watchlist", "ticker": "PYPL", "action": "add" | "remove"}
Use "actions": [] when nothing should be executed. Only include actions the user asked for or agreed to.
Actions execute automatically, in order, and each may fail independently (e.g. insufficient cash,
no price available). Results of earlier actions appear in the conversation history as
"[Action results: ...]"; take failures into account and do not claim a failed action succeeded.
Write the message as if the actions will succeed ("Buying 10 AAPL."), not as a final confirmation."""


def _money(value: float | None) -> str:
    return "n/a" if value is None else f"${value:,.2f}"


def _num(value: float | None, fmt: str = ",.2f") -> str:
    return "n/a" if value is None else format(value, fmt)


def build_context(portfolio: dict, watchlist: list[dict]) -> str:
    """Render the user's current portfolio and watchlist as compact text for the model."""
    lines = [
        "Current portfolio:",
        f"- Cash: {_money(portfolio.get('cash_balance'))}",
        f"- Total value: {_money(portfolio.get('total_value'))}",
        f"- Unrealized P&L: {_money(portfolio.get('unrealized_pnl'))}",
        f"- Realized P&L: {_money(portfolio.get('realized_pnl'))}",
    ]
    positions = portfolio.get("positions") or []
    if positions:
        lines.append(
            "Positions (ticker | qty | avg cost | price | market value | unrealized P&L | %):"
        )
        for p in positions:
            lines.append(
                f"- {p['ticker']} | {_num(p.get('quantity'), 'g')} | {_money(p.get('avg_cost'))}"
                f" | {_money(p.get('current_price'))} | {_money(p.get('market_value'))}"
                f" | {_money(p.get('unrealized_pnl'))} | {_num(p.get('unrealized_pnl_pct'))}%"
            )
    else:
        lines.append("Positions: none")

    if watchlist:
        lines.append("Watchlist (ticker | price | change since session open):")
        for w in watchlist:
            price, open_ = w.get("price"), w.get("session_open")
            change = (
                f"{(price - open_) / open_ * 100:+.2f}%" if price is not None and open_ else "n/a"
            )
            lines.append(f"- {w['ticker']} | {_money(price)} | {change}")
    else:
        lines.append("Watchlist: empty")
    return "\n".join(lines)


def history_to_messages(history: list[dict]) -> list[dict]:
    """Convert stored chat messages (API item shape) to LLM messages, including action results."""
    messages = []
    for item in history:
        content = item.get("message") or ""
        actions = item.get("actions")
        if item.get("role") == "assistant" and actions:
            content += "\n[Action results: " + json.dumps(actions) + "]"
        messages.append({"role": item.get("role", "user"), "content": content})
    return messages


def build_messages(context: str, history: list[dict], user_message: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": context},
        *history_to_messages(history),
        {"role": "user", "content": user_message},
    ]
