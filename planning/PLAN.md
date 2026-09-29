# TraMa — AI Trading Workstation

## Project Specification

## 1. Vision

TraMa (Trade Master) is a visually stunning AI-powered trading workstation that streams live market data, lets users trade a simulated portfolio, and integrates an LLM chat assistant that can analyze positions and execute trades on the user's behalf. It looks and feels like a modern Bloomberg terminal with an AI copilot.

This is the capstone project for an agentic AI coding course. It is built entirely by Coding Agents demonstrating how orchestrated AI agents can produce a production-quality full-stack application. Agents interact through files in `planning/`.

## 2. User Experience

### First Launch

The user runs a single Docker command (or a provided start script). A browser opens to `http://localhost:8000`. No login, no signup. They immediately see:

- A watchlist of 10 default tickers with live-updating prices in a grid
- $10,000 in virtual cash
- A dark, data-rich trading terminal aesthetic
- An AI chat panel ready to assist

### What the User Can Do

- **Watch prices stream** — prices flash green (uptick) or red (downtick) with subtle CSS animations that fade
- **View sparkline mini-charts** — price action beside each ticker in the watchlist, accumulated on the frontend from the SSE stream since page load (sparklines fill in progressively)
- **Click a ticker** to see a larger detailed chart in the main chart area
- **Buy and sell shares** — market orders only, instant fill at current price, no fees, no confirmation dialog
- **Monitor their portfolio** — a heatmap (treemap) showing positions sized by weight and colored by P&L, plus a P&L chart tracking total portfolio value over time
- **View a positions table** — ticker, quantity, average cost, current price, unrealized P&L, % change
- **Chat with the AI assistant** — ask about their portfolio, get analysis, and have the AI execute trades and manage the watchlist through natural language
- **Manage the watchlist** — add/remove tickers manually or via the AI chat

### Visual Design

- **Dark theme**: backgrounds around `#0d1117` or `#1a1a2e`, muted gray borders, no pure black
- **Price flash animations**: brief green/red background highlight on price change, fading over ~500ms via CSS transitions
- **Connection status indicator**: a small colored dot (green = connected, yellow = reconnecting, red = disconnected) visible in the header
- **Professional, data-dense layout**: inspired by Bloomberg/trading terminals — every pixel earns its place
- **Responsive but desktop-first**: optimized for wide screens, functional on tablet

### Color Scheme
- Accent Yellow: `#ecad0a`
- Blue Primary: `#209dd7`
- Purple Secondary: `#753991` (submit buttons)

## 3. Architecture Overview

### Single Container, Single Port

```
┌─────────────────────────────────────────────────┐
│  Docker Container (port 8000)                   │
│                                                 │
│  FastAPI (Python/uv)                            │
│  ├── /api/*          REST endpoints             │
│  ├── /api/stream/*   SSE streaming              │
│  └── /*              Static file serving        │
│                      (Next.js export)           │
│                                                 │
│  SQLite database (volume-mounted)               │
│  Background tasks: market data sim/poller,      │
│                    portfolio snapshots (30s)    │
└─────────────────────────────────────────────────┘
```

- **Frontend**: Next.js with TypeScript, built as a static export (`output: 'export'`), served by FastAPI as static files
- **Backend**: FastAPI (Python), managed as a `uv` project
- **Database**: SQLite, single file at `db/trama.db`, volume-mounted for persistence
- **Real-time data**: Server-Sent Events (SSE) — simpler than WebSockets, one-way server→client push, works everywhere
- **AI integration**: LiteLLM → OpenRouter (Cerebras for fast inference), with structured outputs for trade execution
- **Market data**: Environment-variable driven — simulator by default, real data via Massive API if key provided

### Why These Choices

| Decision | Rationale |
|---|---|
| SSE over WebSockets | One-way push is all we need; simpler, no bidirectional complexity, universal browser support |
| Static Next.js export | Single origin, no CORS issues, one port, one container, simple deployment |
| SQLite over Postgres | No auth = no multi-user = no need for a database server; self-contained, zero config |
| Single Docker container | Students run one command; no docker-compose for production, no service orchestration |
| uv for Python | Fast, modern Python project management; reproducible lockfile; what students should learn |
| Market orders only | Eliminates order book, limit order logic, partial fills — dramatically simpler portfolio math |

---

## 4. Directory Structure

```
trade_assistant_app/
├── frontend/                 # Next.js TypeScript project (static export)
├── backend/                  # FastAPI uv project (Python)
│   └── app/
│       ├── market/           # Market data subsystem (complete)
│       └── db/               # Schema definitions, seed data, lazy init logic
├── planning/                 # Project-wide documentation for agents
│   ├── PLAN.md               # This document
│   └── ...                   # Additional agent reference docs
├── scripts/
│   ├── start_mac.sh          # Launch Docker container (macOS/Linux)
│   ├── stop_mac.sh           # Stop Docker container (macOS/Linux)
│   ├── start_windows.ps1     # Launch Docker container (Windows PowerShell)
│   └── stop_windows.ps1      # Stop Docker container (Windows PowerShell)
├── test/                     # Playwright E2E tests (run from host against the container)
├── db/                       # Volume mount target (SQLite file lives here at runtime)
│   └── .gitkeep              # Directory exists in repo; trama.db is gitignored
├── Dockerfile                # Multi-stage build (Node → Python)
├── .env                      # Environment variables (gitignored, .env.example committed)
└── .gitignore
```

### Key Boundaries

- **`frontend/`** is a self-contained Next.js project. It knows nothing about Python. It talks to the backend via `/api/*` endpoints and `/api/stream/*` SSE endpoints, using the contract in §8. Internal structure is up to the Frontend Engineer agent.
- **`backend/`** is a self-contained uv project with its own `pyproject.toml`. It owns all server logic including database initialization, schema, seed data, API routes, SSE streaming, market data, and LLM integration. All Python code lives inside the `app` package (the wheel build only includes `app`). Internal structure is up to the Backend/Market Data agents.
- **`backend/app/db/`** contains schema SQL definitions and seed logic. The backend lazily initializes the database on startup — creating tables and seeding default data if the SQLite file doesn't exist or is empty.
- **`db/`** at the top level is the runtime volume mount point. The SQLite file (`db/trama.db`) is created here by the backend and persists across container restarts via Docker volume.
- **`planning/`** contains project-wide documentation, including this plan. All agents reference files here as the shared contract.
- **`test/`** contains Playwright E2E tests. Unit tests live within `frontend/` and `backend/` respectively, following each framework's conventions.
- **`scripts/`** contains start/stop scripts that wrap Docker commands. These are the only supported way to launch (no top-level `docker-compose.yml`).

---

## 5. Environment Variables

```bash
# OpenRouter API key for LLM chat functionality.
# The app starts without it; only chat is degraded (returns an explanatory message).
OPENROUTER_API_KEY=your-openrouter-api-key-here

# Optional: Massive (Polygon.io) API key for real market data
# If not set, the built-in market simulator is used (recommended for most users)
MASSIVE_API_KEY=

# Optional: Set to "true" for deterministic mock LLM responses (testing)
LLM_MOCK=false

# Optional: SQLite file location. Defaults to <project_root>/db/trama.db
# (inside Docker: /app/db/trama.db)
DB_PATH=
```

### Behavior

- If `MASSIVE_API_KEY` is set and non-empty → backend uses Massive REST API for market data
- If `MASSIVE_API_KEY` is absent or empty → backend uses the built-in market simulator
- If `LLM_MOCK=true` → backend returns deterministic mock LLM responses (see §9) — no API key needed
- If `OPENROUTER_API_KEY` is missing and `LLM_MOCK` is not `true` → the app runs normally; `/api/chat` replies with a message explaining the key is not configured
- If `DB_PATH` is unset → `<project_root>/db/trama.db`, so local `uv run` and Docker use the same layout
- The backend reads `.env` from the project root (mounted into the container or read via docker `--env-file`)

---

## 6. Market Data

### Two Implementations, One Interface

Both the simulator and the Massive client implement the same abstract interface. The backend selects which to use based on the environment variable. All downstream code (SSE streaming, price cache, frontend) is agnostic to the source.

### Simulator (Default)

- Generates prices using geometric Brownian motion (GBM) with configurable drift and volatility per ticker
- Updates at ~500ms intervals
- Correlated moves across tickers (e.g., tech stocks move together)
- Occasional random "events" — sudden 2-5% moves on a ticker for drama
- Starts from realistic seed prices (e.g., AAPL ~$190, GOOGL ~$175, etc.); tickers without a seed price start at a random $50–300
- Runs as an in-process background task — no external dependencies
- **Known behavior:** prices restart from seed values on every backend restart, while positions and `avg_cost` persist. Unrealized P&L and the P&L chart will jump across restarts. This is accepted for a simulated demo.

### Massive API (Optional)

- REST API polling (not WebSocket) — simpler, works on all tiers
- Polls for the union of all tracked tickers on a configurable interval
- Free tier (5 calls/min): poll every 15 seconds
- Paid tiers: poll every 2-15 seconds depending on tier
- Parses REST response into the same format as the simulator
- **Expected UX difference:** at 15s polling, price flashes and sparkline points are far sparser than with the 500ms simulator. This is not a bug.
- A ticker that doesn't exist upstream simply never receives a price; it shows as "—" in the UI and trades on it are rejected (no price available).

### Tracked Tickers

The set of tickers the market source prices is **`watchlist ∪ tickers with open positions`**. This keeps held positions valued and sellable even after they're removed from the watchlist.

- Adding to the watchlist → `source.add_ticker(t)`
- Removing from the watchlist → `source.remove_ticker(t)` **only if** there's no open position in `t`
- Fully selling a position in a ticker not on the watchlist → `source.remove_ticker(t)`
- Buying a ticker not yet tracked → it is auto-added to the watchlist first (see §8 trade rules)

### Shared Price Cache

- A single background task (simulator or Massive poller) writes to an in-memory price cache
- The cache holds the latest price, previous price, timestamp, and **session open** for each ticker
- **Session open** = the first price the cache recorded for that ticker since backend start (the seed price for the simulator). It is the baseline for the watchlist's "change %" column. *Required addition to the completed market code:* `PriceCache` records the first price per ticker and `PriceUpdate.to_dict()` includes `session_open`.
- SSE streams read from this cache and push updates to connected clients
- This architecture supports future multi-user scenarios without changes to the data layer

### SSE Streaming

- Endpoint: `GET /api/stream/prices`
- Long-lived SSE connection; client uses native `EventSource` API
- The first message is `retry: 1000` (browser reconnects 1s after a drop)
- Server checks the cache every ~500ms and, **when anything changed**, sends one event containing **all tracked tickers** as a dict keyed by ticker:

```
data: {"AAPL": {"ticker": "AAPL", "price": 190.52, "previous_price": 190.41,
                "session_open": 190.00, "timestamp": 1790000000.123,
                "change": 0.11, "change_percent": 0.0578, "direction": "up"},
       "GOOGL": {...}, ...}
```

- `change` / `change_percent` / `direction` are relative to the **previous tick** (drive the flash animation). Session change % is computed on the frontend as `(price - session_open) / session_open * 100`.
- `timestamp` is Unix seconds (float).
- A ticker missing from an event has been removed from tracking; the frontend should drop it.
- Client handles reconnection automatically (EventSource has built-in retry)

---

## 7. Database

### SQLite with Lazy Initialization

The backend checks for the SQLite database on startup. If the file doesn't exist or tables are missing, it creates the schema and seeds default data. This means:

- No separate migration step
- No manual database setup
- Fresh Docker volumes start with a clean, seeded database automatically

### Schema

All tables except `users_profile` include a `user_id` column defaulting to `"default"` (`users_profile` uses `id` as the user key). The user id is a single backend constant (`DEFAULT_USER_ID = "default"`); do not build any user-switching plumbing — the column exists only so future multi-user support needs no migration.

**users_profile** — User state (cash balance)
- `id` TEXT PRIMARY KEY (default: `"default"`)
- `cash_balance` REAL (default: `10000.0`)
- `created_at` TEXT (ISO timestamp)

**watchlist** — Tickers the user is watching
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT (default: `"default"`)
- `ticker` TEXT
- `added_at` TEXT (ISO timestamp)
- UNIQUE constraint on `(user_id, ticker)`

**positions** — Current holdings (one row per ticker per user)
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT (default: `"default"`)
- `ticker` TEXT
- `quantity` REAL (fractional shares supported)
- `avg_cost` REAL
- `updated_at` TEXT (ISO timestamp)
- UNIQUE constraint on `(user_id, ticker)`

**trades** — Trade history (append-only log)
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT (default: `"default"`)
- `ticker` TEXT
- `side` TEXT (`"buy"` or `"sell"`)
- `quantity` REAL (fractional shares supported)
- `price` REAL
- `executed_at` TEXT (ISO timestamp)

**portfolio_snapshots** — Portfolio value over time (for P&L chart). Recorded every 30 seconds by a background task, including when the portfolio is cash-only. (No extra snapshot after trades: a market-price trade doesn't change total value at the instant of execution.)
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT (default: `"default"`)
- `total_value` REAL
- `recorded_at` TEXT (ISO timestamp)

**chat_messages** — Conversation history with LLM
- `id` TEXT PRIMARY KEY (UUID)
- `user_id` TEXT (default: `"default"`)
- `role` TEXT (`"user"` or `"assistant"`)
- `content` TEXT
- `actions` TEXT (JSON array of action results — same shape as `actions` in the `/api/chat` response; null for user messages)
- `created_at` TEXT (ISO timestamp)

### Default Seed Data

- One user profile: `id="default"`, `cash_balance=10000.0`
- Ten watchlist entries: AAPL, GOOGL, MSFT, AMZN, TSLA, NVDA, META, JPM, V, NFLX

### Trading Rules

These apply identically to manual trades and LLM trades (one shared function):

- **Ticker normalization:** uppercase + strip whitespace; must match `^[A-Z][A-Z.]{0,5}$`
- **Quantity:** must be `> 0`; rounded to 4 decimal places
- **Price:** the current cache price at execution. No price in the cache → reject (`"No price available for XYZ"`)
- **Buy:** requires `cash_balance >= quantity × price`. New `avg_cost = (old_qty × old_avg + qty × price) / (old_qty + qty)`. If the ticker is not on the watchlist, it is auto-added.
- **Sell:** requires `quantity <= held quantity`. `avg_cost` is unchanged (average-cost method). If remaining quantity is below `1e-6`, the position row is deleted.
- **Money:** cash is rounded to cents on every write
- **Realized P&L:** `(sell_price - avg_cost) × quantity` is computed at sell time and returned in the trade result; cumulative realized P&L is derived from `trades` for `/api/portfolio` (no extra column)
- **Atomicity:** the read-check-write of cash, position, and trade row happens in a single SQLite transaction guarded by a process-wide `asyncio.Lock`, so concurrent manual and LLM trades can't double-spend

---

## 8. API Endpoints

All endpoints are JSON. Errors use FastAPI's default shape `{"detail": "human-readable message"}` with status `400` (validation/business rule failure, e.g. insufficient cash), `404` (unknown resource), or `422` (malformed request body).

### Market Data
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stream/prices` | SSE stream of live price updates (payload in §6) |

### Portfolio
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/portfolio` | Current positions, cash balance, total value, unrealized and realized P&L |
| POST | `/api/portfolio/trade` | Execute a trade |
| GET | `/api/portfolio/history` | Portfolio value snapshots (for P&L chart) |

`GET /api/portfolio` →
```json
{
  "cash_balance": 8095.00,
  "total_value": 10012.40,
  "unrealized_pnl": 12.40,
  "realized_pnl": 0.0,
  "positions": [
    {"ticker": "AAPL", "quantity": 10, "avg_cost": 190.50, "current_price": 191.74,
     "market_value": 1917.40, "unrealized_pnl": 12.40, "unrealized_pnl_pct": 0.65}
  ]
}
```
If a position has no cached price, `current_price`, `market_value`, and P&L fields are `null` and it is valued at `avg_cost` for `total_value`.

`POST /api/portfolio/trade` with `{"ticker": "AAPL", "side": "buy", "quantity": 10}` →
`200` `{"ticker": "AAPL", "side": "buy", "quantity": 10, "price": 190.50, "realized_pnl": null, "cash_balance": 8095.00}` or `400` `{"detail": "Insufficient cash: need $1905.00, have $500.00"}`

`GET /api/portfolio/history?hours=24` (default 24) →
```json
{"snapshots": [{"recorded_at": "2026-09-28T14:00:00Z", "total_value": 10000.0}, ...]}
```

### Watchlist
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/watchlist` | Current watchlist tickers with latest prices |
| POST | `/api/watchlist` | Add a ticker: `{"ticker": "PYPL"}` |
| DELETE | `/api/watchlist/{ticker}` | Remove a ticker |

`GET /api/watchlist` → `{"tickers": [{"ticker": "AAPL", "price": 190.52, "session_open": 190.00}, ...]}` (`price`/`session_open` are `null` if not yet priced)

`POST` → `201` with the new entry (same item shape); `400` for an invalid symbol; adding a ticker already present returns `200` with the existing entry (idempotent).
`DELETE` → `204`; `404` if not on the watchlist. The ticker keeps being priced if a position is open (§6 Tracked Tickers).

### Chat
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Send `{"message": "..."}`, receive the complete assistant response with executed actions |
| GET | `/api/chat/history?limit=50` | Recent messages (oldest first) so the chat panel restores on page reload |

`POST /api/chat` → always `200` (LLM/API failures are reported in `message`, with `actions: []`):
```json
{
  "id": "uuid",
  "role": "assistant",
  "message": "Bought 10 AAPL at $190.50. You now hold 10 shares.",
  "actions": [
    {"type": "trade", "ticker": "AAPL", "side": "buy", "quantity": 10,
     "status": "ok", "price": 190.50, "error": null},
    {"type": "watchlist", "ticker": "PYPL", "action": "add",
     "status": "error", "error": "Invalid ticker symbol"}
  ],
  "created_at": "2026-09-28T14:00:00Z"
}
```

`GET /api/chat/history` → `{"messages": [{"id", "role", "message", "actions", "created_at"}, ...]}` — same item shape as the POST response (`actions` is `null` for user messages), so live and restored messages render through one component.

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | `{"status": "ok"}` (for Docker/deployment) |

---

## 9. LLM Integration

When writing code to make calls to LLMs, use cerebras-inference skill to use LiteLLM via OpenRouter to the `openrouter/openai/gpt-oss-120b` model with Cerebras as the inference provider. Structured Outputs should be used to interpret the results.

There is an OPENROUTER_API_KEY in the .env file in the project root.

### How It Works

When the user sends a chat message, the backend:

1. Loads the user's current portfolio context (cash, positions with P&L, watchlist with live prices, total portfolio value)
2. Loads the last 20 messages from the `chat_messages` table
3. Constructs a prompt with a system message, portfolio context, conversation history, and the user's new message
4. Calls the LLM via LiteLLM → OpenRouter, requesting structured output, using the cerebras-inference skill
5. Parses and validates the structured JSON response
6. Executes the actions **in order, best-effort**: each trade/watchlist change runs independently through the same functions as the manual endpoints; a failure on one does not stop the others
7. Stores the user message and the assistant message (with per-action results) in `chat_messages`
8. Returns the complete JSON response to the frontend (§8 shape; no token-by-token streaming — Cerebras inference is fast enough that a loading indicator is sufficient)

### Structured Output Schema

The LLM is instructed to respond with JSON matching this schema — a single `actions` list with a `type` discriminator:

```json
{
  "message": "Your conversational response to the user",
  "actions": [
    {"type": "trade", "ticker": "AAPL", "side": "buy", "quantity": 10},
    {"type": "watchlist", "ticker": "PYPL", "action": "add"}
  ]
}
```

- `message` (required): The conversational text shown to the user
- `actions` (optional, default `[]`): Trades (`side`: `buy`|`sell`, `quantity` > 0) and watchlist changes (`action`: `add`|`remove`) to auto-execute. Each goes through the same validation as manual requests (§7 Trading Rules).

The backend adds `status` (`"ok"`|`"error"`), `error`, and for trades the fill `price` to each action before returning/storing it.

### Auto-Execution

Trades specified by the LLM execute automatically — no confirmation dialog. This is a deliberate design choice:
- It's a simulated environment with fake money, so the stakes are zero
- It creates an impressive, fluid demo experience
- It demonstrates agentic AI capabilities — the core theme of the course

If an action fails validation (e.g., insufficient cash), its `status` is `"error"` with a reason, shown inline in the chat; the LLM sees these results in the next turn's history.

### Failure Handling

If the LLM call times out (30s), the API key is missing/invalid, or the response fails schema validation: return `200` with an assistant `message` explaining the problem (e.g. "The AI assistant is unavailable: OPENROUTER_API_KEY is not configured"), `actions: []`, and log the error server-side. Nothing is executed. The assistant message is still stored so history stays consistent.

### System Prompt Guidance

The LLM should be prompted as "TraMa, an AI trading assistant" with instructions to:
- Analyze portfolio composition, risk concentration, and P&L
- Suggest trades with reasoning
- Execute trades when the user asks or agrees
- Convert dollar-amount requests ("buy $500 of NVDA") into share quantities using the current price in context, rounded down to 4 decimals
- Manage the watchlist proactively
- Be concise and data-driven in responses
- Always respond with valid structured JSON

### LLM Mock Mode

When `LLM_MOCK=true`, the backend returns deterministic mock responses instead of calling OpenRouter. This enables fast, free, reproducible E2E tests, development without an API key, and CI/CD pipelines.

Mock rules (case-insensitive, first match wins, evaluated against the user's message):

| User message pattern | Mock response |
|---|---|
| `buy <qty> <TICKER>` | `message: "Buying <qty> <TICKER>."`, one `trade` buy action |
| `sell <qty> <TICKER>` | `message: "Selling <qty> <TICKER>."`, one `trade` sell action |
| `add <TICKER>` / `watch <TICKER>` | `message: "Adding <TICKER> to your watchlist."`, one `watchlist` add action |
| `remove <TICKER>` / `unwatch <TICKER>` | `message: "Removing <TICKER> from your watchlist."`, one `watchlist` remove action |
| anything else | `message: "Mock TraMa here. Your portfolio is worth $<total_value>."`, no actions |

Mock actions go through the real execution path, so validation errors behave exactly as in live mode.

---

## 10. Frontend Design

### Layout

The frontend is a single-page application with a dense, terminal-inspired layout. The specific component architecture and layout system is up to the Frontend Engineer, but the UI should include these elements:

- **Watchlist panel** — grid/table of watched tickers with: ticker symbol, current price (flashing green/red on change), change % since session open (from `session_open` in the SSE payload), and a sparkline mini-chart (accumulated from SSE since page load). Unpriced tickers show "—".
- **Main chart area** — larger chart for the currently selected ticker, with at minimum price over time. Clicking a ticker in the watchlist selects it here.
- **Portfolio heatmap** — treemap visualization where each rectangle is a position, sized by portfolio weight, colored by P&L (green = profit, red = loss)
- **P&L chart** — line chart showing total portfolio value over time, using `/api/portfolio/history`
- **Positions table** — tabular view of all positions: ticker, quantity, avg cost, current price, unrealized P&L, % change
- **Trade bar** — simple input area: ticker field, quantity field, buy button, sell button. Market orders, instant fill. Errors from the API (`detail`) shown inline.
- **AI chat panel** — docked/collapsible sidebar. Loads `/api/chat/history` on mount. Message input, scrolling conversation history, loading indicator while waiting for LLM response. Actions shown inline as confirmations (✓) or failures (✗ with the error).
- **Header** — portfolio total value (updating live), connection status indicator, cash balance

### Data Flow

- **Live values** (header total value, positions table prices/P&L, heatmap colors) are computed on the frontend as `cash + Σ(quantity × latest SSE price)` — updates every tick with no polling.
- **Refetch `/api/portfolio` and `/api/watchlist`** on page load and after every trade, watchlist change, or chat response containing actions.
- **Refetch `/api/portfolio/history`** on page load and every 30s.

### Technical Notes

- Use `EventSource` for SSE connection to `/api/stream/prices`. Connection status: `onopen` → green; `onerror` while `readyState === CONNECTING` → yellow; `readyState === CLOSED` → red.
- **Recharts** for all charts (main price chart, sparklines, treemap, P&L line). Data volumes are small (tens of tickers, a few thousand points), so SVG performance is fine and one library keeps things simple.
- Price flash effect: on receiving a new price, briefly apply a CSS class with background color transition, then remove it
- All API calls go to the same origin (`/api/*`) — no CORS configuration needed. For local frontend dev, proxy `/api` to `localhost:8000`.
- Tailwind CSS for styling with a custom dark theme
- Static export constraints: `output: 'export'`, `images: { unoptimized: true }`, no Next.js API routes or server-side data fetching

---

## 11. Docker & Deployment

### Multi-Stage Dockerfile

```
Stage 1: Node 22 slim (LTS)
  - Copy frontend/
  - npm ci && npm run build (produces static export in out/)

Stage 2: Python 3.12 slim
  - Install uv
  - Copy backend/
  - uv sync --frozen --no-dev (install Python dependencies from lockfile)
  - Copy frontend build output into a static/ directory
  - Expose port 8000
  - CMD: uvicorn serving FastAPI app
```

FastAPI serves the static frontend files and all API routes on port 8000. Register all `/api/*` routers **before** mounting `StaticFiles(directory="static", html=True)` at `/`, otherwise the static mount shadows the API.

### Docker Volume

The SQLite database persists via a named Docker volume:

```bash
docker run -v trama-data:/app/db -p 8000:8000 --env-file .env trama
```

The `db/` directory in the project root maps to `/app/db` in the container. The backend writes `trama.db` to this path.

### Start/Stop Scripts

**`scripts/start_mac.sh`** (macOS/Linux):
- Builds the Docker image if not already built (or if `--build` flag passed)
- Runs the container with the volume mount, port mapping, and `.env` file
- Prints the URL to access the app
- Optionally opens the browser

**`scripts/stop_mac.sh`** (macOS/Linux):
- Stops and removes the running container
- Does NOT remove the volume (data persists)

**`scripts/start_windows.ps1`** / **`scripts/stop_windows.ps1`**: PowerShell equivalents for Windows.

All scripts should be idempotent — safe to run multiple times.

### Optional Cloud Deployment

The container is designed to deploy to AWS App Runner, Render, or any container platform. A Terraform configuration for App Runner may be provided in a `deploy/` directory as a stretch goal, but is not part of the core build.

---

## 12. Testing Strategy

### Unit Tests (within `frontend/` and `backend/`)

**Backend (pytest)**:
- Market data: simulator generates valid prices, GBM math is correct, Massive API response parsing works, both implementations conform to the abstract interface, `session_open` is recorded once per ticker
- Portfolio: trade execution logic, avg-cost math, realized P&L, edge cases (selling more than owned, buying with insufficient cash, selling at a loss, selling the full position deletes the row, no price available, invalid ticker, concurrent trades)
- Tracked tickers: removing a watched ticker with an open position keeps it priced; selling out of an unwatched ticker stops pricing it
- LLM: structured output parsing handles all valid schemas, graceful handling of malformed responses / timeouts / missing key, best-effort execution with mixed success/failure, mock-mode rules
- API routes: status codes and response shapes match §8

**Frontend (React Testing Library or similar)**:
- Component rendering with mock data
- Price flash animation triggers correctly on price changes
- Connection status state machine (connected → reconnecting → disconnected) driven by mocked `EventSource` events
- Watchlist CRUD operations
- Portfolio display calculations (live total value from SSE prices)
- Chat message rendering (including ✓/✗ action results) and loading state

### E2E Tests (in `test/`)

**Infrastructure**: Playwright runs on the host (`npx playwright test`, `baseURL=http://localhost:8000`) against the app container started with `LLM_MOCK=true`. This keeps browser dependencies out of the production image with no extra compose files.

**Key Scenarios** (using the mock rules in §9):
- Fresh start: default watchlist appears, $10k balance shown, prices are streaming
- Add and remove a ticker from the watchlist
- Buy shares: cash decreases, position appears, portfolio updates
- Sell shares: cash increases, position updates or disappears
- Portfolio visualization: heatmap renders with correct colors, P&L chart has data points
- AI chat (mocked): send `buy 1 AAPL`, receive a response, trade confirmation appears inline and the position appears
- Chat history survives a page reload

SSE reconnection is covered by the frontend unit test above rather than E2E (browser-native retry; killing the server mid-test is slow and flaky).
