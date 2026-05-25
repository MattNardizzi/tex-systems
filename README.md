# Tex — frontend (v0.2.0)

The product dashboard, designed as Steve Jobs would design it in 2050.

## What's here

Two states only:

- **All quiet** — the resting state. A breathing orb in the same blue-gray
  glass treatment as the marketing site's "Absolute." headline, with the
  words "All quiet" rendered in the same glass type underneath.
- **Asks you** — the moment something needs you. The orb shifts amber and
  slows; beside it, Tex says one sentence in serif italic ("Kestrel asked
  to wire fifty thousand dollars in your CEO's name. _I said no._"), with
  two actions: **Show me** and **Thank you**.

The six rooms (Discovery, Identity, Observability, Execution, Evidence,
Evolution) live behind a single gesture in the bottom-right corner. They
are not a navigation grid; each is a sentence Tex says in the first
person.

## Run

```bash
npm install
npm run dev
```

With no backend wired, you'll see the asking state by default (mock data).
A tiny dev toggle in the bottom-left flips between Asking and Quiet.

## Connecting the backend

Set `VITE_TEX_API_BASE` to your Render URL (e.g.
`https://tex-api.onrender.com`) in Vercel → Settings → Environment
Variables. The hook will then call:

- `GET  /api/execution/focus`       current decision to surface
- `GET  /api/execution/stats`       hourly counters
- `GET  /api/execution/:id/evidence` evidence bundle for a decision
- `POST /api/execution/:id/ack`     acknowledge a decision
- `POST /api/tex/ask`               natural-language question

The contract is unchanged from v0.1; only the UI changed.

## Tokens

All values live in `src/index.css` under `:root`:

- `--tex-canvas` `#F5F2EC` — the warm wash from the screenshot
- `--tex-glass-1..4` — the four stops of the "Absolute." gradient
- `--tex-serif`, `--tex-sans` — Source Serif 4, Inter
- `--tex-ink`, `--tex-ink-soft`, `--tex-ink-mute` — three ink weights

## Structure

```
src/
  components/Dashboard/
    Dashboard.jsx       shell, washes, footer
    TopBar.jsx          T mark · presence · avatar
    Orb.jsx             the breathing presence (quiet | asking)
    GlassWord.jsx       the "Absolute." treatment, reusable
    AllQuiet.jsx        resting-state layout
    AsksYou.jsx         asking-state layout
    RoomsOverlay.jsx    the six rooms behind a single gesture
  hooks/
    useExecutionData.js current focus + actions, mock fallback
  lib/
    texApi.js           same contract as v0.1
  pages/
    DashboardPage.jsx   the only page
```

## What was removed

- The six-tile gradient grid
- The "Monday morning" header
- The top search bar
- The "Ask Tex anything" footer bar
- Phosphor icon dependency (no icons in the new design)
