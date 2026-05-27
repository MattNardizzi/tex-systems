# Tex — dashboard

The product surface for Tex. Pure white paper, one orb, three type sizes — exact parity with the marketing site. This is what the operator sees after they sign in.

## The whole vocabulary, in two gestures

There is no menu. There is no bottom-right pill. There is no settings cog. The product is navigated with two gestures, taught once, used forever:

1. **Touch the orb** → walk into the rooms.
2. **Press the T mark** (top-left, on every screen) → return home.

The orb is the door. The T is the way out. That's it. Each gesture is taught with a single, one-time, never-repeats ambient cue on the first device visit.

## Two states (the dashboard at rest)

### AllQuiet — at rest

The orb breathes alone in the center. It is a button. Hover changes the cursor, a faint outer halo brightens. Click it (or focus it and press Enter / Space) to walk into the rooms.

Beneath the orb, in serif italic, Tex states what it's been doing while the operator wasn't watching:

> _I let 4,827 through today._ None needed you.

Below that, a single small pulse — one dot, one number, the tick of a wristwatch you weren't watching but trust:

```
•  17s
```

**First-visit cue.** ~2 seconds after the orb settles in, a single soft ring releases outward from the orb and the words *touch tex* fade in below the sentence. The whole cue lasts about 3.5 seconds, then disappears. Stored in `localStorage` as `tex.taught.touch` — never returns on this device.

### AsksYou — the moment

When Tex stops something, the orb drifts left into a track at ~26% from the canvas edge. Beside it, in serif italic, Tex says one thing:

> _Kestrel asked to wire fifty thousand dollars in your CEO's name._
> _I said no._

Two actions in the colleague's vocabulary: a black **Show me** pill (opens the decision), and a quiet **Got it** plain link (closes the loop). The orb never panics — same blue-gray glass in both states. The composition tells the operator something changed, not the temperature of the room.

## The rooms (full canvas, one room per screen)

Touch the orb and the whole canvas becomes the rooms. The TopBar stays on (the T is always the way home). Each room is four things and nothing else:

- **The sentence.** Tex's voice in serif italic, ~50px. _It is a button._ Click it to walk into the room's interior.
- **The proof label** below the sentence. Small upright sans, lowercase, muted — `discovery — 83 found · 2 new · 1 quiet`. The back of the fence. Confirms what Tex just said in machine vocabulary, never re-stating it.
- **Dots** below the proof — position indicator + jump-to.
- **An X** at the top-right to close the rooms (the T mark in the top-left also returns home).

Pinned to the bottom of the viewport, the same single line appears in every room: _want me to do this for your agents?_ — soft serif italic, no pill, no box. It's the only CTA on the marketing experience. Phrased as a question so it reads as continuation of Tex's voice, not as a sales button. The visitor can leave the story at whichever room moved them; the ask is identical everywhere so they only notice it when they're ready.

No eyebrow label. No "Walk in" pill. The sentence is the room name and the door at the same time.

### The six rooms

The rooms are Tex's day, in the order Tex lives it. One room per backend layer. The visitor walks the whole arc — what's out there, who they are, what they're doing, what was decided, what was sealed, what to learn next.

```
DISCOVERY   I found eighty-three agents in your environment
            this week. Two were new. One had gone quiet.
IDENTITY    All of them are who they say they are. One asked
            for more than I'd given it. I held the line.
MONITORING  I'm watching them all, right now. Nothing is
            drifting. I'll tell you the moment something does.
EXECUTION   I made four thousand eight hundred twenty-seven
            decisions today. I allowed four thousand eight
            hundred twenty-six. I stopped one.
EVIDENCE    I wrote it all down. If anyone ever asks, I can
            prove it.
LEARNING    I've learned two things this week. I'd like your
            sign-off before I use them.
```

Below each sentence, a small upright-sans proof label confirms what was just said: `discovery — 83 found · 2 new · 1 quiet`. The back of the fence. The eye lands on the sentence first, the proof second, never the other way around.

Earlier drafts collapsed the six layers into four rooms (merging Discovery+Identity, dropping Monitoring as redundant). That was wrong. The six rooms map one-to-one onto the six architectural layers in the backend (`docs/layers/LAYER_*.md`). The interface is the layer architecture, made audible — Tex narrating its own anatomy in the order the anatomy runs. Cutting any of the six broke the correspondence and made the page feel like marketing rather than truth.

### Navigating between rooms

The user advances by any natural input:

- mouse wheel
- two-finger trackpad swipe (horizontal or vertical)
- arrow keys (←/→/↑/↓)
- PageUp / PageDown
- Space (forward)
- swipe on touch (up/left = next, down/right = previous)
- clicking a dot

A ~600ms debounce prevents a single trackpad gesture from skipping multiple rooms. Each advance is one room. Each gesture snaps. The dots reflect position in real time.

### First-visit cue inside the rooms

~1.5 seconds after the overlay opens on a brand-new device, *tap to look closer* fades in below the first sentence, holds, fades out. Stored in `localStorage` as `tex.taught.rooms`. Fires once per device, on whichever room the user lands on first. The lesson is "sentences are doors" — applies to all six rooms after the user learns it once. We do not teach it six times.

### Room interiors

Clicking a sentence fires `onOpenRoom(key)` with the room key (`discovery`, `identity`, `monitoring`, `execution`, `evidence`, `learning`). The interior view is not wired in this pass — that's the next layer of the product. The door exists; the room behind the door is the next thing to build.

This is by design: the conversational surface (sentence) is one product, the interior (agent inventory, identity records, monitoring stream, filtered decision log, evidence chain, learning proposals) is another. The CISO/tech buyer lives inside the rooms; the CRO/General Counsel reads the sentence and walks home satisfied. Same screen, two readings, no split product.

## Design system

Same as the marketing site.

- **Canvas:** pure white (`#ffffff`). No ambient washes.
- **Type:** three sizes only.
  - Display serif italic (`Source Serif 4`, 28–52px) — the one sentence per state.
  - Reading serif italic (18–22px) — asides.
  - Proof mono (`SF Mono`, 10–11px) — machine identifiers, pulses, cues.
- **Ink:** `#14110d` on paper, with two soft greys (`#5e564c`, `#9b9388`).
- **Glass:** the orb is the only soft object. Everything else is hard-edged.
- **Motion:** the orb breathes (presence). It drifts (attention). Arrivals 0.55–0.9s, overlay 0.25s, cues 2.4s with hold. Nothing performs for its own sake.

## Wiring the live data

Two values in `AllQuiet.jsx` are currently mocked and should come from your hook:

| Mock value         | Where it lives                       | Should come from           |
|--------------------|--------------------------------------|----------------------------|
| `actionsToday`     | `AllQuiet.jsx` constant `4827`       | `stats.decisionsThisHour`  |
| `secondsAgo`       | `AllQuiet.jsx` ticker starting at 14 | seconds since last decision timestamp |

The four room sentences in `RoomsOverlay.jsx` are similarly static — they should eventually be templated from live counts (`watch`: `${agentCount}`, `execution`: `${allowed}` / `${stopped}`, `learning`: `${pendingProposals}`).

## Dev toggle

The dev toggle does not exist in the production DOM. In dev mode it is summoned with `⌘.` (or `Ctrl+.`) and dismissed with Escape. A debug button living permanently in the corner of a shipping product is a confession that the product isn't finished. We don't ship the confession.

## localStorage keys

```
tex.taught.touch     — first-visit cue on the orb has played
tex.taught.rooms     — first-visit cue inside the rooms has played
```

Clearing the browser is equivalent to becoming a new user — both cues will play again on next visit. This is correct.

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
    Dashboard.jsx                  the shell — TopBar + body + rooms overlay
    Dashboard.css
    TopBar.jsx                     fixed header — T (home), presence, avatar
    TopBar.css
    AllQuiet.jsx                   resting state — orb (clickable) + sentence
                                   + pulse + first-visit cue
    AllQuiet.css
    AsksYou.jsx                    event state — orb drift + sentence + actions
    AsksYou.css
    RoomsOverlay.jsx               four rooms, one per screen, snap-scrolling,
                                   sentence-as-door, first-visit cue
    RoomsOverlay.css
    Orb.jsx                        the breathing presence (shared with homepage)
    Orb.css
```

— VortexBlack
