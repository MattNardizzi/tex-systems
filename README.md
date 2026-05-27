# Tex — dashboard

The product surface for Tex. Pure white paper, one orb, three type sizes — exact parity with the marketing site. This is what the operator sees after they sign in.

## Two states

The dashboard has two states, switched by whether a decision is currently the focus.

### AllQuiet — at rest

The orb breathes alone in the center. Beneath it, in serif italic, Tex states what it has been doing while the operator wasn't watching:

> _I let 4,827 through today._ None needed you.

Below that, a single small pulse — one dot, one number, the tick of a wristwatch you weren't watching but trust:

```
•  17s
```

That's it. The earlier draft put three machine facts here (LAST DECISION · 17s AGO · EVIDENCE ON FILE). It was honest but it competed with the line above. The line is the point.

### AsksYou — the moment

When Tex stops something, the orb drifts left into a track at ~26% from the canvas edge. Beside it, in serif italic, Tex says one thing:

> _Kestrel asked to wire fifty thousand dollars in your CEO's name._
> _I said no._

Two actions in the colleague's vocabulary: a black **Show me** pill (opens the decision), and a quiet **Got it** plain link (closes the loop). "Got it" instead of "Thank you" — the operator is acknowledging Tex, not thanking it. Thank-you is the wrong direction of gratitude in a working relationship.

The orb never panics — same blue-gray glass in both states. The composition tells the operator something changed, not the temperature of the room. The summary type is calmer than the earlier 60px draft — the orb drift is what alarms, the words just need to be readable.

## The rooms

Four rooms live behind one gesture in the bottom-right of the canvas. Each is one sentence Tex says in the first person, never a label:

```
WATCH      I'm watching eighty-three agents. All of them
           are who they say they are.
EXECUTION  I allowed four thousand eight hundred sixteen
           today. I stopped one.
EVIDENCE   Every decision sealed. Ready when you need them.
LEARNING   I've learned two things this week. I'd like
           your sign-off before I use them.
```

Earlier drafts had six rooms (Discovery, Identity, Observability, Execution, Evidence, Evolution). Discovery and Identity are one thought — what's out there, and who they really are. Observability collapses into the same sentence ("nothing has drifted" is just Watch's quiet day). "Evolution" was reaching for grandeur; "Learning" is the plainer, harder, more honest word.

Four sentences you can hold in your head. Six was a feature list dressed as poetry.

The overlay is a white scrim with backdrop blur. No cards. No grid. The list is the chapter index of Tex.

## Design system

Same as the marketing site.

- **Canvas:** pure white (`#ffffff`). No ambient washes.
- **Type:** three sizes only.
  - Display serif italic (`Source Serif 4`, 28–44px) — the one sentence per state.
  - Reading serif italic (18–22px) — asides and the rooms list.
  - Proof mono (`SF Mono`, 10–11px) — machine identifiers, the pulse.
- **Ink:** `#14110d` on paper, with two soft greys (`#5e564c`, `#9b9388`).
- **Glass:** the orb is the only soft object. Everything else is hard-edged.
- **Motion:** the orb breathes (presence). It drifts (attention). Arrivals at 0.9s, overlay rises at 0.35s — calm, not lazy. Nothing performs for its own sake.

## Wiring the live data

Two values in `AllQuiet.jsx` are currently mocked and should come from your hook:

| Mock value         | Where it lives                       | Should come from           |
|--------------------|--------------------------------------|----------------------------|
| `actionsToday`     | `AllQuiet.jsx` constant `4827`       | `stats.decisionsThisHour`  |
| `secondsAgo`       | `AllQuiet.jsx` ticker starting at 14 | seconds since last decision timestamp |

Pass them in as props once the hook exposes them. The structure is set up to receive them.

## Dev toggle

The dev toggle does not exist in the production DOM. In dev mode it is summoned with `⌘.` (or `Ctrl+.`) and dismissed with Escape. A debug button living permanently in the corner of a shipping product is a confession that the product isn't finished. We don't ship the confession.

## Stack

- Vite + React 18
- Inter + Source Serif 4 (Google Fonts)
- No router, no state library, no UI framework

## Run

```bash
npm install
npm run dev       # http://localhost:5173 — press ⌘. for dev toggle
npm run build     # produces dist/
npm run preview   # serves dist/
```

## File map

```
src/
  App.jsx                          mounts the only page
  main.jsx                         React entry
  index.css                        global tokens — type, ink, paper, dev toggle

  pages/
    DashboardPage.jsx              the only page, wires hook to component

  hooks/
    useExecutionData.js            reads from FastAPI backend; mocks if unset

  lib/
    texApi.js                      thin client for the FastAPI service

  components/Dashboard/
    Dashboard.jsx                  the shell — TopBar + body + footer + rooms
    Dashboard.css
    TopBar.jsx                     three header objects: T mark, Tex is here, avatar
    TopBar.css
    AllQuiet.jsx                   resting state — one sentence + one pulse
    AllQuiet.css
    AsksYou.jsx                    event state — orb drift + serif italic message
    AsksYou.css
    RoomsOverlay.jsx               four rooms in Tex's first-person voice
    RoomsOverlay.css
    Orb.jsx                        the breathing presence (shared with homepage)
    Orb.css
```

— VortexBlack
