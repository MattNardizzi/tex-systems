# TEX — UI LANGUAGE & INTERFACE LAW

**The single source of truth for how Tex looks, moves, and feels.** Locked
2026-06-30, grounded in a frontier-research sweep (Emil Kowalski / animations.dev,
Vercel Geist, Material motion, Apple WWDC spring physics, HCI latency papers,
View Transitions, the Awwwards canon) + an adversarial gimmick-kill pass.

Any thread building Tex UI starts **here**. Do not re-research. Do not start over.
Build against this.

---

## NORTH STAR

> Tex is a precision instrument that is almost entirely still. A near-white field,
> quiet Inter in short bursts, vast deliberate negative space — and nothing
> moving until something true must be witnessed. Then, and only then, the sha-256
> seal computes itself character-by-character and locks. Everything else is so fast
> it is **felt, not seen**.

**"Futuristic" is not spectacle.** It is the *absence of latency* + *one earned
moment* + *impossible precision*. **If you notice an effect, it has failed.** The
seal is the only thing allowed to be noticed.

It must feel like the most sophisticated, **all-present, all-knowing AI security**
that has ever existed — better than anything shipping as of 2026-06-30. That feeling
comes from **subtraction + precision + restraint**, never from adding more.

---

## THE FIVE FUTURES (every screen obeys these)

1. **Telepathic** — first feedback to any input within one frame (~16ms; hard ceiling
   100ms). Nothing ever "loads." When Tex computes, the seal's own lock *is* the
   progress. **No spinners, ever.**
2. **One material** — states **morph** into each other (View Transitions API),
   nothing pops in or out. The surface never page-swaps; it is one continuous substance.
3. **Matter, not animation** — every motion has momentum and a critically-damped
   settle. Never linear, never canned, zero bounce.
4. **Machine-exact** — etched hairline ink, monospace truth locking into a grid that
   never reflows a pixel, tabular alignment. It looks fabricated, not drawn.
5. **Presence, not navigation** — you *reach* (hold / speak / type anywhere); it
   answers; it returns to silence. No menus, no nav, no pages to get lost in.

---

## DOCTRINE (hard rules — do not violate)

- **Type:** Inter for every human word and label — **Michroma is RETIRED
  (2026-07-01, thread 7)**; the whole UI speaks one screen-native voice, worn in
  a narrow 300–500 band, self-hosted (latin subset, `font-display: optional`,
  zero swap). Geist Mono for machine truth only (a sha-256 handle, an exact id).
- **Color:** provably **achromatic**. A neutral ink VALUE ladder, every value R=G=B,
  every shadow `rgba(0,0,0,a)`. **Zero hue.** The *only* hue the surface may ever
  show is the **cold pallor of the faltering breath** (and even that stays nearly
  neutral). Hierarchy is built from SIZE × TRACKING × INK-VALUE × CASE first —
  Inter's weight axis is used sparingly, 300–500 only, never as the lead cue.
- **One hero:** the **seal**. It is the only element that gets a >420ms timeline and
  sequenced motion. Everything else stays quiet and fast so it lands.
- **Restraint is the mechanism.** One meaningful moment per screen. Every element
  must justify itself against "does this serve the seal or the essential task?" If
  not, cut it. **Over-building is the documented failure mode.**

### Anti-patterns (reject on sight)
Cinematic blur openings · particles · glow · magnetic / cursor-reactive elements ·
corner-frame chrome · oversized headlines · decorative color · smooth-scroll libs ·
any hue outside the faltering cold pallor · any spinner · any second "moment" that
competes with the seal.

---

## MOTION TOKENS (the entire vocabulary — exact)

```css
/* EASING — exactly three, nothing else permitted */
--ease:        cubic-bezier(0.16, 1, 0.3, 1);     /* entrances, the seal settle, default */
--ease-micro:  cubic-bezier(0.32, 0.72, 0, 1);    /* on-screen morph / View-Transition group */
--ease-inout:  cubic-bezier(0.76, 0, 0.24, 1);    /* things that breathe */

/* DURATION LADDER — nearly all UI lives in t3/t4. Hard ceiling 400ms for anything
   the user triggers and waits on. The SEAL is the ONLY exception. */
--t1: 120ms;  /* micro: press, hover, color blink */
--t2: 180ms;  /* small enter/exit */
--t3: 240ms;  /* standard: panel, state, focus */
--t4: 320ms;  /* overlay / a View-Transition morph */
--t5: 420ms;  /* large / page-level ceiling (non-seal) */
--rise: 760ms;/* a declared statement entrance (clip-reveal) */
/* RULE: exits run one rung faster than their enter. */

/* TRANSFORM PRIMITIVES — the ONLY animated properties */
/* enter from scale(0.96)+opacity:0 (never scale(0)); press = scale(0.97);
   clip-reveal = inner translateY(110% → 0) behind overflow:hidden. */

/* THE SEAL (the single cinematic exception) */
--seal-stagger: 22ms;   /* per-char lock cadence (band 18–28ms) */
--seal-settle:  140ms;  /* per-char snap: scale 1.0→1.06→1.0, zero overshoot */
--seal-cap:     1400ms; /* full 64-char reveal finishes under this */
/* hex glyphs ONLY (0-9a-f); lock L→R; NO blur/glow/spin/color-shift during scramble;
   at final lock the whole hash DEEPENS from scramble-grey to FULL INK — the value
   jump is the proof signal (achromatic; no accent hue). */

/* COLOR — neutral ink ladder + lit paper */
--ink:#0b0b0b; --ink-2:#2c2c2c; --ink-soft:#5d5d5d; --ink-mute:#9a9a9a; --ink-faint:#c7c7c7;
--hair:rgba(0,0,0,.075); --hair-2:rgba(0,0,0,.14);
--paper:#ffffff; --paper-edge:#f6f6f6;
--cold:#565c61; /* faltering ONLY */

/* TYPE */
/* Inter: weights 300/400/500 only (Michroma retired); uppercase micro-labels
   tracked +0.28em; statements tracked tight (-0.018em) and MODEST in size
   (reject oversized headlines); line-height 1.18 display / 1.55 body.
   Hash row: Geist Mono, tabular, fixed grid. */

/* SURFACE */
/* one soft overhead light (radial, ~2% neutral fall-off) + one luminance-only grain
   tile (soft-light, saturate 0 → no tint, no darkening). Depth from light, never color. */
```

---

## THE EIGHT STATES (one continuous surface)

| # | State | What it is |
|---|-------|-----------|
| 1 | **Threshold** | Day-one open. "I am Tex." → "Nothing happens without me." → "The weight is mine now." (clip-reveal, one at a time) + the single **Begin** act. |
| 2 | **Mapping** | After Begin: the field takes in the estate — a quiet etched beat, **never a spinner** — then speaks the count and clears to the vigil. |
| 3 | **Vigil at rest** | Silence. Empty white. Alive and watching. The faint magnitude ticker (`SEALED 12,948,…`) is the only mark — the all-knowing tell. |
| 4 | **The reach** | Hold (or type) anywhere → a breathing presence mark → "Here." or an answer that surfaces with its credibility tier, then dissolves. Never written-persisted. |
| 5 | **Surfaced object** | The one thing the glass may hold: a hash / exact handle in mono, risen alone, lingers, dissolves. |
| 6 | **Held / ABSTAIN** | The single thing that breaks the silence: a decision only the human can seal. The held sentence, the judgment line, the faint anchor (which **morphs** into the seal), and the acts (Refuse / Keep holding / **Seal**). |
| 7 | **The seal** | The hero. The hash computes itself, locks L→R, deepens to full ink, then the surface returns to silence. |
| 8 | **Faltering** | The cold confession — the evidence chain broke; "Don't trust me until this is resolved." The only state that may carry the cold pallor. |

---

## STATUS & WHERE THINGS LIVE

- **Full cohesive prototype (all 8 states, navigable):** `public/mockups/tex-ui.html`
  — view at `/mockups/tex-ui.html` on the dev server. Arrow keys / number keys 1–8
  walk the states (prototype scaffolding only).
- **The seal, isolated:** `public/mockups/seal-v2.html`.
- **Live app to port into:** `src/components/Dashboard/Vigil.jsx` + `Vigil.css`
  (the seal lives at `.tex-seal` / `.tex-seal-hash`). Global tokens: `src/index.css`
  ("Etched Light" — already white, Michroma, achromatic; the foundation is correct).
- **Build order:** perfect the prototype → port state-by-state into `Vigil` → wire
  tokens app-wide. Push to `main` = live on Vercel; only push on Matt's say-so.

> References for FEEL only, never copy: Igloo Inc, Active Theory.
