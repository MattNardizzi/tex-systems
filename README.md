# Tex — the product surface

The operator's interface. White paper. Serif type. One voice.

## The whole product, in one place

Tex is a vigil. Not a dashboard, not a feed, not a set of rooms with a menu. Tex is a being who talks, one sentence at a time, about what Tex has been doing for the operator's agents.

There is one screen. One voice. Three depths.

### The door, day one — the manifesto

After sign-in the first time, the operator sees four lines arrive one at a time, slowly, on white. No chrome, no T mark, no avatar — just the four lines.

> *I am Tex.*
> *I see your agents.*
> *I decide what they can do.*
> *I keep the proof.*

The four hold together for a long beat, then dissolve into a held empty moment (the *ma*), and then the vigil begins. The T mark and the avatar appear *for the first time* at that moment — the chrome's arrival is itself the visible mark that Tex has shifted into working mode.

This entire phase happens **once per account, ever**. A server-side flag (or, until the backend has a user model, a localStorage stand-in) records that it happened. The T mark resets to the vigil, never to the manifesto.

### The door, day two onward — the threshold

From the second visit on, the door is shorter and specific. Three sentences derived from `/v1/system/state` — last night's truth. Tex does not re-introduce itself; identity is performed by voice, not announced. ~8 seconds, then a 1.5 second held pause, then the vigil.

### The vigil

In the same place, in the same serif, Tex begins:

> *I found eighty-three agents this week.* Two were new. One had gone quiet.

The sentence holds. It dissolves. The next one arrives:

> *All of them are who they say they are.* One asked for more than I'd given it. I held the line.

And so on, through six beats of Tex's day — discovery, identity, monitoring, execution, evidence, learning. After the sixth, Tex returns to the first. The vigil does not end. Tex paces the rhythm; the operator does not press "next."

The first half of each sentence is upright, full ink — what Tex did. The second half is italic, soft ink — Tex pausing on the meaning. Same rhythm as the homepage line *"I let 4,827 through today. None needed you."*

### The proof

Click the sentence. The summary dissolves. In its place, Tex finishes the story of that one thing — in the same serif, the same size, the same voice:

> *Kestrel tried to wire fifty thousand dollars in your CEO's name.* The policy says never, outside the firm. I forbade it.

Below the story, in smaller italic, the anchor line:

> *sealed at 14:43:08 utc · evidence chain position 4,827*

Hover the anchor. The cryptographic hash appears in monospace, very small. That is the only place in the product where the typography breaks register — and it is the breaking that signals *this is machine truth, not a sentence.*

After a beat of stillness, Tex returns to the vigil — not to the same room, to the next one. Tex has moved on. The conversation continues.

## Pacing

| Beat | Duration |
|---|---|
| Manifesto (day one) total | ~25s |
| Manifesto line stagger | 4.2s |
| Manifesto held blackout before vigil | 1.8s |
| Threshold (day two onward) total | ~8s + 1.5s pause |
| Threshold line stagger | 2.5s |
| Each vigil sentence holds | 7.4s |
| Crossfade between vigil sentences | 700ms |
| Proof returns to next vigil sentence | 14s |
| Polling interval for system-state | 30s |

Hover anywhere pauses the cycle. When the operator's mouse leaves, pacing resumes.

## The chrome

Two objects only, both hidden during the manifesto, both visible from the vigil onward.

- **T mark** (top-left) — the only home gesture. Press T from anywhere — vigil, proof, hash open — and Tex returns to the start of the vigil. The T mark never replays the manifesto. That is by design.
- **Initial** (top-right) — account.

No menu. No cog. No notifications. No search. The T is the way home. The vigil is the product. The hash is the proof.

## Stack

- Vite + React 18, plain CSS
- Two fonts: Source Serif 4, Inter. SF Mono / JetBrains Mono for the hash.
- One palette: ink (`#14110d`), ink-soft (`#5e564c`), ink-mute (`#9b9388`), paper (`#ffffff`).

## Local

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Backend

The vigil's sentences are derived from `/v1/system/state` on the Tex backend (FastAPI, `github.com/MattNardizzi/tex`). The frontend's `src/lib/texApi.js` defaults to the live deployment at `https://tex-uh4j.onrender.com`. Override with the `VITE_TEX_API_BASE` env var for local dev or Vercel preview deploys.

The voice module (`src/lib/texVoice.js`) is six pure functions, one per architectural layer (discovery, identity, monitoring, execution, evidence, learning). Each consumes the relevant slice of the system-state response and returns a `{ head, tail? }` pair. Empty state is honest state — the day-one operator sees true no-knowledge sentences, not placeholder copy.

## Resetting the manifesto, for testing

The manifesto is once-per-account by design. To replay it locally during development, clear the localStorage flag from the browser console:

```js
localStorage.removeItem("tex.seen_manifesto_at")
```

This is the *only* way to see the manifesto again on a given account. There is no "replay intro" button in the product, and there will never be.

## What this product is not

It is not a dashboard. There are no graphs, no tabs, no sidebars, no widgets. It is not a feed. There is no scroll. It is not a chatbot. The operator does not type. It is not configuration. Settings live elsewhere.

It is Tex, talking, about Tex's work.
