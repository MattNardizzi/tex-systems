# Tex — the product surface

White paper. One voice. Nothing on the glass that doesn't have to be there.

## What Tex is

Tex is a **witness with authority**. It does not only watch your AI agents — it governs them. The execution layer rules on every action an agent attempts: **PERMIT** it, **FORBID** it on Tex's own authority, or **ABSTAIN** and freeze it for a human. Every ruling is sealed into a hash-chained evidence ledger the moment it's made. So Tex watches, *rules*, and *proves*.

Its voice flexes to match. Tex speaks as a **governor** when it reports a ruling or holds a decision for you, and as a **witness** when it must confess that its own proof has broken.

Tex spans six layers, unified in one product: **discovery, identity, monitoring, execution, evidence, learning.** Every other tool in the category covers a slice and ships a dashboard. Tex covers all six and ships a voice.

## What the surface actually is

One screen. At rest it is **empty white** — no mark, no logo, no breathing letter, no pilot light, no resting pulse. Tex does not post a sign of life. You know it's alive two ways: the kingdom is in order, and when you reach for it, it answers. Silence is the proof that nothing needs you.

The whole surface is the ask gesture: **press and hold anywhere** to speak to Tex. No wake word, no hot mic — Tex listens only while you hold.

The screen breaks its silence in only a few moments, and on open it speaks the most urgent true one, once, then returns to silence:

**Presence.** You open Tex, or you press and hold in silence and say nothing. That's a reach, not a question. Tex answers with one word — *"Here."* — and the paper goes empty. (When the wire is dead, Tex does not say "Here." It cannot, and the stillness already told you.)

**Held.** Tex froze an action it will not take on its own authority. It surfaces the decision in its own voice, with the facts that ground it and the acts that seal it — **Approve / Keep holding / Refuse**. A wire transfer is never approved by a spoken "yes"; it is sealed by a named human act the evidence layer can prove. Resolving it writes a sealed decision, briefly shown, then the surface returns to silence.

**Faltering.** Tex's own integrity broke — the evidence chain snapped, it can no longer prove what it claims. It speaks first, unprompted, the instant it can, because silence while broken is a lie told in the most dangerous window. The field tints faintly toward a sick taupe; the words stay fully legible.

## How you talk to Tex

The whole loop, end to end:

1. **Press and hold anywhere** on the surface and speak. No wake word, no hot mic — the microphone is open only while you hold.
2. **Release** to send. Tex answers **by voice**.
3. If what you reached for was a **handle** — a hash, an exact name — that one object rises on the white, then dissolves. Otherwise the screen simply stays empty.

If you hold and say nothing, that's a reach, not a question, and Tex answers it with one word: *"Here."* The same gesture works in every state — in silence it opens the mic; on a held decision or a faltering surface, Tex's voice speaks first, then the mic opens so you can ask about it.

## The output doctrine (locked)

**The answer is spoken, never written. Meaning lives in the voice; the glass stays clean.** When you ask Tex a question, it speaks the answer and that is all. The screen never holds an answer.

The single thing the surface is ever allowed to hold is an **object** — a handle you grab and walk away with: a hash, an exact identifier like `bedrock-invoke-03`. You don't comprehend a hash, you take it. So when a question's true target is such a handle, that handle — and nothing else — rises alone, monospace, centered, because you reached for it, and dissolves the moment it has been taken. No label, no field, no card.

The boundary is not voice-versus-text. It is **meaning versus object**. Meaning is spoken, always. Objects — the few things that are pure handle, no comprehension required — surface as themselves, then vanish.

This is why there is **no agent view**. "Show me the Bedrock agent" is answered with the worry underneath it, spoken — *"Quiet since four. Reads three buckets, touches nothing else. It's fine."* — never with a screen of fields. You drill deeper by speaking, not by scrolling. Tex answers the feeling, not the request.

## The voice infrastructure (locked)

Tex hears you and speaks back through a **grounded cascade**, and that architecture is a deliberate, defended choice:

1. **Hear** — your held speech streams to best-in-class streaming STT with turn and interruption detection.
2. **Answer** — the transcript hits `/v1/ask`, the **integrity boundary**. The answer is composed only from the six layers and the sealed ledger. Never a free-running model.
3. **Speak** — the grounded answer streams back through low-latency TTS in Tex's one voice.

**Tex must never be "upgraded" to a native speech-to-speech model.** As of 2026 the lowest-latency, trendiest path is an end-to-end S2S model (OpenAI Realtime, Gemini Live, Grok Voice). Those models *generate their own answers* — a free-running model in the speaking seat — which breaks the one thing that makes Tex a witness: that every word it says is grounded in something it can prove. The components in the three slots may be swapped for the best available (e.g. Deepgram Flux / ElevenLabs Scribe for hearing; ElevenLabs / Cartesia for the voice). The cascade shape and the grounding boundary may not.

## What renders, file by file

- `src/components/Dashboard/Vigil.jsx` — the entire product surface. Rest, presence, held, faltering, the seal, the spoken-answer path, and the object that rises and dissolves.
- `src/components/Dashboard/Vigil.css` — the surface styling. Ink on paper, one monospace object, the faltering tint.
- `src/components/Dashboard/Dashboard.jsx` — the shell. No chrome.
- `src/hooks/useHeartbeat.js` — the one honest liveness signal. Drives whether Tex is alive on the wire; a dead wire is the one death Tex cannot speak.
- `src/hooks/useSystemState.js` — chain integrity. A broken chain is what flips the surface into faltering.
- `src/hooks/useVigil.js` — polls `/v1/vigil` for what Tex has chosen to say (held decisions).
- `src/lib/texApi.js` — the only door to the backend. `/v1/voice/token`, `/v1/ask`, `/v1/speak`, plus the read endpoints.
- `src/lib/texVoiceClient.js` — the push-to-talk loop and synthesis playback.
- `public/tex-mic-worklet.js` — the microphone, open only while held.

## Stack

- Vite + React 18, plain CSS.
- Source Serif 4 + Inter; SF Mono / JetBrains Mono for objects (the hash, the name).
- One palette: ink `#14110d`, ink-soft `#5e564c`, ink-mute `#9b9388`, paper `#ffffff`. The only color the surface ever shows that isn't resting ink is the faint sick taupe of a faltering breath.

## Run it

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build && npm run preview
```

## Backend

`src/lib/texApi.js` talks to the Tex backend (FastAPI, `github.com/MattNardizzi/tex`) through a same-origin proxy — the browser never holds the API key. Override the base with `VITE_TEX_API_BASE` for local dev or preview deploys.

## The demo

The frontend ships with demo wiring so the full arc is visible without a live backend. Open `tex.systems` and:

1. *"Here."* lands, holds, and fades.
2. The paper is empty for ~5 seconds.
3. A held wire-transfer decision rises. Click Approve / Keep holding / Refuse.
4. The seal shows briefly, then the surface returns to empty white, reachable.

Press **⌘. / Ctrl+.** for the dev panel. The **ask** row demonstrates the output doctrine without speaking aloud: *count* answers by voice and leaves the glass clean; *agent* speaks a verdict and lifts an exact name, which then dissolves; *prove* speaks a verdict and lifts a hash, which then dissolves. The demo timer and these controls are clearly marked and a real build removes them; the wire delivers decisions on its own clock.

## What this is not

Not a dashboard. No graphs, tabs, sidebars, widgets, alert queues, or posture scores. Not a feed — there is no scroll. Not a chatbot — answers are spoken, not written. There is no agent list and no agent detail screen. There is no home button and no menu, because there is nowhere else to go.

It is Tex: watching, ruling, proving — and silent until it has something only you can decide.

## Current state

Everything above is **locked** and reflects what the code actually does today.

Still **open**, for a future thread to settle:

- **Demo vs live.** The spoken answers and the held decision are demo-wired so the surface can be felt without a backend. Wiring `/v1/ask`, `/v1/voice/token`, and `/v1/speak` to the live grounded backend is not yet done.
- **"Here" — spoken or shown.** Presence currently renders the word *"Here."* on the glass briefly. By the strict letter of the doctrine (only objects touch the glass) it could become audio-only with the screen staying white. Not yet decided.
- **The last T.** `public/favicon.svg` is still a "T" — the browser-tab icon. It's outside the rendered surface, so it was kept; whether to replace or drop it is open.
