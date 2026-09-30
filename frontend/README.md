# TraMa frontend

Next.js (App Router, TypeScript) built as a static export and served by FastAPI on port 8000.
Tailwind v4 for styling (theme tokens in `src/app/globals.css`), Recharts for every chart.

```powershell
npm ci
npm run dev      # http://localhost:3000, proxies /api to $env:BACKEND_URL (default http://localhost:8000)
npm run build    # static export -> out/
npm run lint
npm test         # Vitest + React Testing Library, non-interactive
```

## Layout

- `src/components/Workstation.tsx` — page shell: data fetching, refetch rules, layout
- `src/hooks/usePriceStream.ts` — EventSource on `/api/stream/prices`, connection status, per-ticker history
- `src/hooks/usePriceFlash.ts` — green/red flash on price change
- `src/lib/api.ts` — typed client for the PLAN §8 endpoints (errors surface FastAPI `detail`)
- `src/lib/portfolio.ts` — live revaluation: `cash + Σ qty × latest SSE price`

The chat panel docks at viewport widths ≥ 1280px; below that it is a drawer opened from the header.
