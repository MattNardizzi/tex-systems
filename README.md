# Tex — dashboard

The product surface for Tex. Pure white paper, one orb, three type sizes — exact parity with the marketing site. This is what the operator sees after they sign in.

## Two states

The dashboard has two states, switched by whether a decision is currently the focus.

### AllQuiet — at rest

The orb breathes alone in the center. Beneath it, in serif italic, Tex states what it has been doing while the operator wasn't watching:

> _I let 4,827 through today._ None needed you.

Below that, in small monospace, a live heartbeat:

```
LAST DECISION · 17s AGO · EVIDENCE ON FILE
```

The seconds tick up. The screen at rest is not "blank waiting for something to happen" — it is _the receipt for the silence._ The dashboard equivalent of a clock on a lock screen.

### AsksYou — the moment

When Tex stops something, the orb drifts left into a track at ~26% from the canvas edge. Beside it, in serif italic, Tex says one thing:

> _Kestrel asked to wire fifty thousand dollars in your CEO's name._
> _I said no._

Two actions in the colleague's vocabulary: a black **Show me** pill (opens the decision), and a quiet **Thank you** plain link (dismisses). The orb never panics — same blue-gray glass in both states. The composition tells the operator something changed, not the temperature of the room.

## The rooms

The six rooms live one click away in the bottom-right of the canvas. Each is one sentence Tex says in the first person, never a label:

```
DISCOVERY     I'm watching eighty-three agents across your stack.
IDENTITY      All eighty-three are who they say they are.
OBSERVABILITY Nothing has drifted this week.
EXECUTION     I allowed four thousand eight hundred sixteen,
              held ten, stopped one.
EVIDENCE      Every decision sealed and chained.
              Ready when you need them.
EVOLUTION     I've learned two things this week.
              I'd like your sign-off before I use them.
```

The overlay is a white scrim with backdrop blur. No cards. No grid. The list is the chapter index of Tex.

## Design system

Same as the marketing site.

- **Canvas:** pure white (`#ffffff`). No ambient washes.
- **Type:** three sizes only.
  - Display serif italic (`Source Serif 4`, 36–60px) — the one sentence per state.
  - Reading serif italic (20–26px) — asides and captions.
  - Proof mono (`SF Mono`, 10–11px, uppercase, tracked) — machine identifiers, timestamps, real counts.
- **Ink:** `#14110d` on paper, with two soft greys (`#5e564c`, `#9b9388`).
- **Glass:** the orb is the only soft object. Everything else is hard-edged.
- **Motion:** the orb breathes (presence). It drifts (attention). Nothing performs for its own sake.

## Wiring the live data

Two values in `AllQuiet.jsx` are currently mocked and should come from your hook:

| Mock value         | Where it lives                       | Should come from           |
|--------------------|--------------------------------------|----------------------------|
| `actionsToday`     | `AllQuiet.jsx` constant `4827`       | `stats.decisionsThisHour`  |
| `secondsAgo`       | `AllQuiet.jsx` ticker starting at 14 | seconds since last decision timestamp |

Pass them in as props once the hook exposes them. The structure is set up to receive them.

## Stack

- Vite + React 18
- Inter + Source Serif 4 (Google Fonts)
- No router, no state library, no UI framework

## Run

```bash
npm install
npm run dev       # http://localhost:5173 — with the dev toggle visible
npm run build     # produces dist/
npm run preview   # serves dist/ — dev toggle hidden
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
    AllQuiet.jsx                   resting state — receipt + live heartbeat
    AllQuiet.css
    AsksYou.jsx                    event state — orb drift + serif italic message
    AsksYou.css
    RoomsOverlay.jsx               six rooms in Tex's first-person voice
    RoomsOverlay.css
    Orb.jsx                        the breathing presence (shared with homepage)
    Orb.css
```

— VortexBlack
