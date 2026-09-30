# TraMa E2E tests (Playwright)

Runs from the host against a running app started with `LLM_MOCK=true`.

```powershell
cd test
npm ci
npx playwright install chromium
npx playwright test                 # everything (api + ui projects)
npx playwright test --project=api   # fast §8 contract checks, no browser
$env:BASE_URL = "http://localhost:8001"; npx playwright test   # other host/port
npx playwright show-report
```

Start the app locally (planning/TEAM_CONTRACTS.md §9) with a fresh `DB_PATH`, or in Docker via the start script
with the mock flag. Specs are delta-based and tolerate a non-fresh DB; set `E2E_FRESH_DB=1` to also assert the
exact $10,000 starting cash. Specs run serially (one shared portfolio).
