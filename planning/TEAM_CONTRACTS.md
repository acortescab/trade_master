# TraMa — Team Contracts

Shared internal contracts for the agent team. `PLAN.md` is the product spec (external API in §8 is binding);
this file pins down **ownership** and the **internal Python interfaces** so teammates can build in parallel.
If you need to change a contract here, message the owner(s) and the team lead first, then update this file.

## 1. Team & Ownership

| Agent name | Role | Owns (only this agent edits) |
|---|---|---|
| `db-engineer` | Database Engineer | `backend/app/db/**`, `backend/tests/db/**` |
| `backend-api` | Backend API Engineer | `backend/app/main.py`, `backend/app/config.py`, `backend/app/services/**`, `backend/app/api/**` (except `api/chat.py`), `backend/app/market/**` (small wiring changes only), `backend/tests/{services,api}/**`, `backend/pyproject.toml` `[project]` metadata |
| `llm-engineer` | LLM Engineer | `backend/app/llm/**`, `backend/app/api/chat.py`, `backend/tests/llm/**` |
| `frontend-engineer` | Frontend Engineer | `frontend/**` |
| `devops-engineer` | DevOps Engineer | `Dockerfile`, `.dockerignore`, `scripts/**`, `.env.example`, `db/.gitkeep`, root `.gitignore` |
| `integration-tester` | Integration Tester | `test/**` |

Rules for everyone:
- Don't edit files you don't own — message the owner with the exact change you need.
- **Dependencies:** run `uv add <pkg>` (from `backend/`) or `npm install <pkg>` (from your own npm project). Never hand-edit `uv.lock` / `package-lock.json`. Announce new backend deps to `backend-api`.
- **Git:** do NOT run `git commit`, `git stash`, `git checkout`, `git reset`, or `git clean`. Everyone shares one working tree; the team lead commits at milestones.
- Shell is **Windows PowerShell 5.1** (no `&&`; use `;` or `if ($?) {}`).
- Backend tests: `cd backend; uv run --extra dev pytest tests/<your_dir> -q`. Keep the existing 73 market tests green.
- When your piece is ready, message the team lead and any teammate blocked on you.

## 2. Backend package layout

```
backend/app/
├── main.py            # backend-api: FastAPI app, lifespan, router registration, static mount
├── config.py          # backend-api: env loading (.env at project root), settings
├── state.py           # backend-api: AppState singleton (price_cache, market_source, trade_lock)
├── market/            # existing, complete
├── db/                # db-engineer
├── services/          # backend-api: trading.py, watchlist.py, portfolio.py, snapshots.py
├── api/               # backend-api: health.py, portfolio.py, watchlist.py ; llm-engineer: chat.py
└── llm/               # llm-engineer: schema.py, prompt.py, client.py, mock.py, service.py
```

## 3. Config (`app/config.py`, backend-api)

- Load `.env` from project root (`backend/..`) with `python-dotenv` if present; real env vars win.
- `DB_PATH`: env or `<project_root>/db/trama.db`. Docker sets `DB_PATH=/app/db/trama.db` explicitly.
- `STATIC_DIR`: env or `<backend>/static`. Docker sets `STATIC_DIR=/app/static`. Mount only if the directory exists.
- `LLM_MOCK` (bool, `"true"` case-insensitive), `OPENROUTER_API_KEY`, `MASSIVE_API_KEY`.
- `DEFAULT_USER_ID = "default"` lives in `app/db/__init__.py` (db-engineer) and is re-used everywhere.

## 4. DB layer (`app/db`, db-engineer)

Stdlib `sqlite3`, synchronous (fast, local file). `check_same_thread=False`, `row_factory = sqlite3.Row`,
`PRAGMA foreign_keys=ON`, `journal_mode=WAL`. Timestamps: ISO-8601 UTC with `Z` suffix. IDs: `uuid4` strings.

```python
# app/db/__init__.py re-exports everything below
DEFAULT_USER_ID = "default"

def init_db(db_path: str) -> None                 # create dirs/tables if missing, seed if empty; idempotent
def get_connection() -> sqlite3.Connection        # the process-wide connection (after init_db)
@contextmanager
def transaction() -> Iterator[sqlite3.Connection] # BEGIN IMMEDIATE ... COMMIT / ROLLBACK on error

# Every repo function takes an optional conn (defaults to get_connection()) so callers can compose
# several calls inside one transaction(). user_id defaults to DEFAULT_USER_ID.
# profile
def get_cash(conn=None, user_id=...) -> float
def set_cash(amount: float, conn=None, user_id=...) -> None          # rounds to cents
# watchlist
def list_watchlist(conn=None, user_id=...) -> list[str]              # ordered by added_at
def add_watchlist(ticker: str, conn=None, user_id=...) -> bool       # False if already present
def remove_watchlist(ticker: str, conn=None, user_id=...) -> bool    # False if not present
# positions
def get_position(ticker, conn=None, user_id=...) -> Position | None  # dataclass(ticker, quantity, avg_cost, updated_at)
def list_positions(conn=None, user_id=...) -> list[Position]
def upsert_position(ticker, quantity, avg_cost, conn=None, user_id=...) -> None
def delete_position(ticker, conn=None, user_id=...) -> None
# trades
def insert_trade(ticker, side, quantity, price, conn=None, user_id=...) -> Trade   # dataclass incl. id, executed_at
def realized_pnl_total(conn=None, user_id=...) -> float   # derived from trades by replaying avg-cost per ticker
# snapshots
def insert_snapshot(total_value: float, conn=None, user_id=...) -> None
def list_snapshots(since_iso: str, conn=None, user_id=...) -> list[dict]   # [{"recorded_at", "total_value"}] oldest first
# chat
def insert_chat_message(role: str, content: str, actions: list[dict] | None, conn=None, user_id=...) -> dict
      # returns {"id","role","message","actions","created_at"}  (API item shape, §8)
def list_chat_messages(limit: int = 50, conn=None, user_id=...) -> list[dict]      # oldest first, same shape
```

## 5. Services (`app/services`, backend-api)

The single shared path for manual and LLM actions. Business-rule failures raise `TradeError` / `WatchlistError`
(both subclass `ServiceError(Exception)` with a human-readable `str()`), which the routers map to HTTP 400.

```python
# app/state.py
class AppState: price_cache: PriceCache; market_source: MarketDataSource; trade_lock: asyncio.Lock
def get_state() -> AppState

# app/services/trading.py
def normalize_ticker(raw: str) -> str      # upper+strip, validate ^[A-Z][A-Z.]{0,5}$, raises ServiceError("Invalid ticker symbol")
async def execute_trade(ticker: str, side: str, quantity: float) -> dict
    # returns {"ticker","side","quantity","price","realized_pnl","cash_balance"}  (§8 trade response)

# app/services/watchlist.py
async def add_ticker(ticker: str) -> tuple[dict, bool]    # (item {"ticker","price","session_open"}, created)
async def remove_ticker(ticker: str) -> None              # raises WatchlistNotFound(ServiceError) → 404
def get_watchlist() -> list[dict]

# app/services/portfolio.py
def get_portfolio() -> dict                               # §8 GET /api/portfolio shape
def get_history(hours: float = 24) -> list[dict]
```

## 6. LLM (`app/llm`, llm-engineer)

- Uses the `cerebras` skill: LiteLLM → `openrouter/openai/gpt-oss-120b`, Cerebras provider, structured output (Pydantic).
- `app/llm/service.py: async def handle_chat(message: str) -> dict` returns the §8 `/api/chat` response.
- Executes actions via `app.services.trading.execute_trade` / `app.services.watchlist.add_ticker|remove_ticker`,
  catching `ServiceError` per action (best-effort).
- `app/api/chat.py` exposes `router` (APIRouter) with `POST /api/chat` and `GET /api/chat/history`;
  backend-api includes it in `main.py`.
- Until services exist, develop against the signatures above (stub/mocks in tests).

## 7. Frontend ↔ backend

- Only the §6/§8 HTTP contract in PLAN.md. Dev: Next dev server proxies `/api` → `http://localhost:8000`.
- `npm run build` must produce `frontend/out/` (static export). DevOps copies it to `/app/static`.
- Add stable `data-testid` attributes on key elements for E2E (see §8 below).

## 8. E2E test hooks (frontend-engineer ↔ integration-tester)

Minimum `data-testid`s: `header-total-value`, `header-cash`, `connection-status` (with `data-status="connected|reconnecting|disconnected"`),
`watchlist-row-<TICKER>`, `watchlist-price-<TICKER>`, `watchlist-add-input`, `watchlist-add-button`, `watchlist-remove-<TICKER>`,
`main-chart`, `trade-ticker`, `trade-quantity`, `trade-buy`, `trade-sell`, `trade-error`,
`positions-table`, `position-row-<TICKER>`, `heatmap`, `pnl-chart`,
`chat-input`, `chat-send`, `chat-message` (each message), `chat-action` (with `data-status="ok|error"`), `chat-loading`.

## 9. Running the app locally (without Docker)

```powershell
cd frontend; npm run build; cd ..
$env:STATIC_DIR = "$PWD\frontend\out"; $env:LLM_MOCK = "true"; $env:DB_PATH = "$PWD\db\e2e.db"
cd backend; uv run uvicorn app.main:app --port 8000
```
