# Tex

The customer-facing application for Tex — full-lifecycle governance for autonomous AI systems.

## Stack

- **Frontend:** Vite + React 18 (deploys to Vercel)
- **Backend:** FastAPI (deploys to Render — separate repo)
- **Icons:** Phosphor
- **Fonts:** Inter + Source Serif 4 (loaded via Google Fonts)

## Run locally

```bash
npm install
npm run dev
```

Opens `http://localhost:5173`. The Execution room renders with mock data immediately — no backend required to see the design.

## Build for production

```bash
npm run build
```

Output goes to `dist/`. Vercel runs this automatically on every push to `main`.

## Project structure

```
src/
  App.jsx                       # Root component
  main.jsx                      # React entry point
  index.css                     # Global reset
  components/
    Execution/
      ExecutionRoom.jsx         # The execution room
      ExecutionRoom.css         # All execution styling
  hooks/
    useExecutionData.js         # Wires component to API (mock fallback)
  lib/
    texApi.js                   # Fetch client for FastAPI backend
  pages/
    ExecutionPage.jsx           # Route component
public/
  favicon.svg                   # Black "T" mark
index.html                      # HTML entry, preloads fonts
vite.config.js                  # Vite config
vercel.json                     # Vercel deployment config
package.json                    # Dependencies
```

## Connecting the backend

Set this environment variable in **Vercel → Project Settings → Environment Variables**:

```
VITE_TEX_API_BASE = https://your-tex-api.onrender.com
```

When unset, the app uses mock data so you can develop the frontend without a running backend.

## Backend endpoints expected

The hook calls five routes on the FastAPI service:

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/execution/focus` | `{ id, summary, aside, badge, timestamp }` |
| GET | `/api/execution/stats` | `{ decisionsThisHour, needsYou }` |
| GET | `/api/execution/:id/evidence` | full evidence bundle |
| POST | `/api/execution/:id/ack` | `{ ok: true }` |
| POST | `/api/tex/ask` | `{ text, evidence_id? }` |

The FastAPI service needs CORS enabled for your Vercel domain.

## Deploy to Vercel

1. Push to GitHub (`main` branch)
2. In Vercel: **New Project → Import Git Repository → MattNardizzi/tex-aegis**
3. Vercel auto-detects Vite. Leave all defaults.
4. Click **Deploy**.
5. (Optional) Add `VITE_TEX_API_BASE` env var once the backend is live.

That's it. Subsequent pushes to `main` deploy automatically.
