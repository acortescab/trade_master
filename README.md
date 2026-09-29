# TraMa — AI Trading Workstation

TraMa (Trade Master) is an AI-powered trading workstation with a Bloomberg-style dark UI. It streams live market prices, lets you trade a simulated $10,000 portfolio, and includes an AI chat assistant that can analyze your positions and place trades for you.

It's the capstone project for an agentic AI coding course, built entirely by coordinated coding agents.

> **Status:** The market data subsystem is complete. The API, database, frontend, and Docker packaging are in progress. See [`planning/PLAN.md`](planning/PLAN.md).

## Features

- Live price streaming over SSE, with green/red flash animations and sparklines
- Simulated trading: market orders, instant fills, fractional shares, no fees
- Portfolio heatmap, P&L chart, and positions table
- AI copilot (LiteLLM → OpenRouter → Cerebras) that executes trades and edits the watchlist from natural language
- Built-in GBM market simulator, with optional real data from the Massive (Polygon.io) API

## Architecture

A single Docker container serves everything on port 8000:

- **Backend:** FastAPI (Python, managed with `uv`), serving the REST API, SSE streams, and the static frontend
- **Frontend:** Next.js + TypeScript as a static export, styled with Tailwind, charts in Recharts
- **Database:** SQLite at `db/trama.db`, created and seeded automatically on first run

## Quick Start

1. Create `.env` in the project root:

   ```bash
   OPENROUTER_API_KEY=your-key   # optional; only the chat needs it
   MASSIVE_API_KEY=              # optional; leave empty to use the simulator
   LLM_MOCK=false                # true = deterministic mock AI replies (for tests)
   ```

2. Start the app:

   ```bash
   ./scripts/start_mac.sh          # macOS/Linux
   .\scripts\start_windows.ps1     # Windows PowerShell
   ```

3. Open http://localhost:8000.

Stop the app with `scripts/stop_mac.sh` or `scripts/stop_windows.ps1`. Your data lives in the `trama-data` Docker volume and survives restarts.

## Development

```bash
cd backend
uv sync --extra dev
uv run --extra dev pytest -v        # run tests
uv run --extra dev ruff check .     # lint
uv run market_data_demo.py          # terminal dashboard of live simulated prices
```

## Project Layout

```
backend/    FastAPI app (uv project) — market data, API, DB, LLM
frontend/   Next.js static-export UI
planning/   Specs and agent coordination docs (start with PLAN.md)
scripts/    Docker start/stop scripts
test/       Playwright E2E tests
db/         SQLite volume mount
```

## License

See [LICENSE](LICENSE).
