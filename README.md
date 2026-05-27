# Tex — the product surface

The operator's interface. White paper. Serif type. One voice.

## The whole product, in one place

Tex is a vigil. Not a dashboard, not a feed, not a set of rooms with a menu. Tex is a being who talks, one sentence at a time, about what Tex has been doing for the operator's agents.

There is one screen. One voice. Three depths.

### The door

After sign-in, the operator sees four lines:

> *I am Tex.*
> *I see your agents.*
> *I decide what they can do.*
> *I keep the proof.*

The lines arrive in sequence. They hold long enough to be read at the pace of breath, then dissolve.

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
| Each door line stagger | 180ms |
| Door holds before dissolving | 6.2s |
| Each vigil sentence holds | 7.4s |
| Crossfade between sentences | 700ms |
| Proof returns to vigil | 14s |

Hover anywhere pauses the cycle. When the operator's mouse leaves, pacing resumes.

## The chrome

Two objects only.

- **T mark** (top-left) — the only home gesture. Press T from anywhere — vigil, proof, hash open — and Tex returns to the door.
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

## What this product is not

It is not a dashboard. There are no graphs, no tabs, no sidebars, no widgets. It is not a feed. There is no scroll. It is not a chatbot. The operator does not type. It is not configuration. Settings live elsewhere.

It is Tex, talking, about Tex's work.
