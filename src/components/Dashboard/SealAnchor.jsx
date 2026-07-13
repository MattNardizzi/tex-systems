import { useEffect, useRef } from "react";

/* ------------------------------------------------------------------ */
/* The seal's anchor — the one earned moment. The REAL sha-256 the      */
/* evidence layer anchored computes itself onto the glass: hex cells    */
/* scramble faintly, lock left→right on a 22ms cadence with a 140ms     */
/* settle, then each deepens from scramble-grey to true ink — the value */
/* jump IS the proof signal (achromatic, never a hue). Structural chars */
/* (a UUID's dashes) arrive already true. Mechanics ported from the     */
/* locked prototype (public/mockups/tex-ui.html, runSeal). Imperative   */
/* on purpose: N cells on one rAF clock, zero React re-renders mid-lock.*/
/* ------------------------------------------------------------------ */

const HEX = "0123456789abcdef";
/* Only a full 64-char hex anchor earns the hero lock; anything else renders
   through the quiet static fallback in the card — never a fabricated run. */
export const SEAL_ANCHOR_RE = /^[0-9a-f]{64}$/i;
/* Any hex-ish digest or id worth the cinematic — a sha256, a decision UUID, a
   truncated anchor. A plain name (no long hex run) never scrambles. */
export const SEALED_NUMBER_RE = /[0-9a-f]{8}/i;

const SEAL_STAGGER_MS = 22; /* per-char lock cadence (law band 18–28ms) */
const SEAL_SETTLE_MS = 140; /* per-char snap; 1.04 peak, zero bounce */
const SEAL_TICK_MS = 33; /* scramble flicker cadence */
const SEAL_DEEP_LAG_MS = 180; /* lock (mid ink) → deepen (true ink) */
const SEAL_LEAD_IN_MS = 600; /* the number is seen computing before it locks */

/* The seal-settle easing, as a Web Animations literal. WAAPI easing can't read a
   CSS custom property, so this MUST stay byte-identical to --tex-ease in
   index.css (cubic-bezier(0.16, 1, 0.3, 1)) — change the two together. */
export const TEX_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

const isHexChar = (ch) => /[0-9a-f]/i.test(ch);

/* The shared engine. Fills `row` with one span per character and runs the
   scramble→lock on a single rAF clock. Hex characters flicker then snap;
   structural characters (dashes, colons) are already true and lock on arrival,
   yet still hold their place in the left→right rhythm. Returns a teardown. */
function runScrambleLock(row, rawTarget) {
  const target = rawTarget.toLowerCase();

  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  row.textContent = "";
  const cells = Array.from(target, (ch) => {
    const cell = document.createElement("span");
    cell.className = "tex-seal-cell";
    const scrambles = !reduce && isHexChar(ch);
    if (!scrambles) {
      /* Reduced motion, or a structural glyph: the truth arrives locked. */
      cell.textContent = ch;
      cell.classList.add("is-locked", "is-deep");
    } else {
      cell.textContent = HEX[(Math.random() * 16) | 0];
    }
    cell.__scrambles = scrambles;
    row.appendChild(cell);
    return cell;
  });
  if (reduce) return () => {};

  const locked = cells.map((c) => !c.__scrambles);
  const deepTimers = [];
  let raf = 0;
  let alive = true;
  let start = null;
  let last = 0;

  const frame = (now) => {
    if (!alive) return;
    /* Hold the clock while the tab is hidden — the lock never runs unseen. */
    if (document.hidden) {
      raf = requestAnimationFrame(frame);
      return;
    }
    if (start === null) {
      start = now + SEAL_LEAD_IN_MS;
      last = now;
    }
    const elapsed = now - start;
    const flick = now - last >= SEAL_TICK_MS;
    if (flick) last = now;
    let done = true;
    for (let i = 0; i < cells.length; i += 1) {
      if (locked[i]) continue;
      if (elapsed >= i * SEAL_STAGGER_MS) {
        locked[i] = true;
        const cell = cells[i];
        cell.textContent = target[i];
        cell.classList.add("is-locked");
        if (cell.animate) {
          /* Promote the cell to the compositor ONLY for the 140ms settle, then
             release — a per-cell will-change that never outlives its animation,
             so nothing is left resident on the sealed glass. */
          cell.style.willChange = "transform";
          const settle = cell.animate(
            [
              { transform: "translateY(3px) scale(1)" },
              { transform: "translateY(0) scale(1.04)", offset: 0.6 },
              { transform: "translateY(0) scale(1)" },
            ],
            {
              duration: SEAL_SETTLE_MS,
              easing: TEX_EASE,
              fill: "both",
            }
          );
          const release = () => {
            cell.style.willChange = "";
          };
          if (settle.finished) settle.finished.then(release, release);
          else settle.onfinish = release;
        }
        deepTimers.push(
          setTimeout(() => {
            if (alive) cell.classList.add("is-deep");
          }, SEAL_DEEP_LAG_MS)
        );
      } else {
        done = false;
        if (flick) {
          /* Pre-echo: a 45% bias toward the true glyph, so the truth is
             already half-visible in the scramble before it locks. */
          cells[i].textContent =
            Math.random() < 0.45 ? target[i] : HEX[(Math.random() * 16) | 0];
        }
      }
    }
    if (done) return;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    alive = false;
    if (raf) cancelAnimationFrame(raf);
    deepTimers.forEach(clearTimeout);
  };
}

/* The reusable cinematic — any sealed number Tex shows computes itself onto the
   glass. `value` is the number; `className` styles the row (the seal anchor, or
   the reached object). The cells are theatre; aria carries the plain truth. */
export function ScrambleSeal({ value, className }) {
  const rowRef = useRef(null);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    return runScrambleLock(row, value);
  }, [value]);
  return <span className={className} ref={rowRef} aria-label={value} />;
}

/* The hero anchor — the full sha256 as the seal's earned moment, in its own
   block row (Geist Mono, nowrap, clamped). Cell states driven above. */
export default function SealAnchor({ hash }) {
  const rowRef = useRef(null);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    return runScrambleLock(row, hash);
  }, [hash]);
  return <p className="tex-seal-anchor" ref={rowRef} aria-label={hash} />;
}
