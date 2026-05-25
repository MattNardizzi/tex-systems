# Tex Execution Room — install notes

You're on **Vite + React (Vercel)** and **FastAPI (Render)**. These files drop
straight into `src/`. Pixel-matches the screenshot.

## 1. Files

```
src/
  components/Execution/
    ExecutionRoom.jsx     # the room
    ExecutionRoom.css     # all styling
  hooks/
    useExecutionData.js   # wires hook → API (mock fallback included)
  lib/
    texApi.js             # fetch client for Render backend
  pages/
    ExecutionPage.jsx     # route component
```

## 2. Install dependencies

Only one new dep — the icon set used in the sidebar:

```bash
npm install @phosphor-icons/react
```

If you already use `lucide-react` or another icon set, swap the imports at the
top of `ExecutionRoom.jsx` — names are the same conceptually.

## 3. Fonts

The screenshot uses **Source Serif 4** for the serif and **Inter** for sans.
Add this once to your `index.html` `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Source+Serif+4:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
```

Or self-host them via `@fontsource/inter` and `@fontsource/source-serif-4`
if you want zero third-party calls (often required for the kind of buyer
who'll be looking at Tex).

## 4. Route it

In whatever router you use (React Router, TanStack Router, etc):

```jsx
import ExecutionPage from "./pages/ExecutionPage";

<Route path="/execution" element={<ExecutionPage />} />
```

## 5. Vercel — environment variable

Set in **Vercel → Project → Settings → Environment Variables**:

```
VITE_TEX_API_BASE = https://your-tex-api.onrender.com
```

When this is **unset**, the component renders with mocked data
(`decisionsThisHour: 4827`, the Kestrel verdict, etc) so you can build the
visual and wire the backend independently. When set, the hook calls your
FastAPI endpoints.

## 6. FastAPI endpoints to add on Render

The hook expects five routes. Sketch:

```python
from fastapi import APIRouter

router = APIRouter()

@router.get("/api/execution/focus")
def get_focus():
    decision = current_focus_decision()  # from your governance.execution layer
    return {
        "id": decision.id,
        "summary": humanize(decision),       # NL summary — see §7
        "aside": humanize_aside(decision),
        "badge": "stopped" if decision.verdict == "FORBID" else "held",
        "timestamp": decision.ts.isoformat(),
    }

@router.get("/api/execution/stats")
def get_stats():
    return {
        "decisionsThisHour": count_last_hour(),
        "needsYou": count_open_review(),
    }

@router.get("/api/execution/{decision_id}/evidence")
def evidence(decision_id: str):
    return load_evidence_bundle(decision_id)

@router.post("/api/execution/{decision_id}/ack")
def ack(decision_id: str):
    mark_acknowledged(decision_id)
    return {"ok": True}

@router.post("/api/tex/ask")
def ask(body: dict):
    return route_to_llm(body["text"])  # see §7
```

## 7. "Ask Tex anything" — the LLM layer

Keep it read-only for v1. Inside `route_to_llm`:

1. Receive the text.
2. Call your LLM (Claude Sonnet 4.6 / 4.7 recommended; you already have OpenAI
   plumbing if you prefer reuse) with a tool-use system prompt that exposes:
   - `get_recent_decisions(filters)`
   - `get_decision_by_id(id)`
   - `get_layer_status(layer)`
   - `search_decisions(query)`
3. The LLM picks a tool, you execute against your existing FastAPI handlers,
   feed the result back, and let the LLM compose a Tex-voice response.
4. Return `{ "text": "...", "evidence_id": "..." }` to the frontend.

The frontend listens for `tex:reply` events — wire those to render the
response inline as a second card, or as a toast, or however you want.

## 8. Voice — when you're ready

The Ask Tex bar is already an input. Add a mic button to its right that calls
`navigator.mediaDevices.getUserMedia` → posts the blob to a new
`/api/tex/voice` endpoint → backend transcribes with Whisper → feeds into the
same `/api/tex/ask` pipeline. 1–2 days of work on top of the text version.

## 9. Render — backend deployment

Nothing special. The FastAPI app needs CORS enabled for your Vercel domain:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://texaegis.com", "https://www.texaegis.com",
                   "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```
