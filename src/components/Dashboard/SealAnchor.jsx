import { useEffect, useRef } from "react";

/* ------------------------------------------------------------------ */
/* The seal's anchor — the one earned moment. The REAL sha-256 the      */
/* evidence layer anchored computes itself onto the glass: 64 hex       */
/* cells scramble faintly, lock left→right on a 22ms cadence with a     */
/* 140ms settle, then each deepens from scramble-grey to true ink —     */
/* the value jump IS the proof signal (achromatic, never a hue).        */
/* Mechanics ported from the locked prototype                           */
/* (public/mockups/tex-ui.html, runSeal). Imperative on purpose: 64     */
/* cells on one rAF clock, zero React re-renders mid-lock.              */
/* ------------------------------------------------------------------ */

const HEX = "0123456789abcdef";
/* Only a full 64-char hex anchor earns the lock; anything else renders
   through the quiet static fallback in the card — never a fabricated run. */
export const SEAL_ANCHOR_RE = /^[0-9a-f]{64}$/i;

const SEAL_STAGGER_MS = 22; /* per-char lock cadence (law band 18–28ms) */
const SEAL_SETTLE_MS = 140; /* per-char snap; 1.04 peak, zero bounce */
const SEAL_TICK_MS = 33; /* scramble flicker cadence */
const SEAL_DEEP_LAG_MS = 180; /* lock (mid ink) → deepen (true ink) */
const SEAL_LEAD_IN_MS = 600; /* the hash is seen computing before it locks */

export default function SealAnchor({ hash }) {
  const rowRef = useRef(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const target = hash.toLowerCase();

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    row.textContent = "";
    const cells = Array.from(target, (ch) => {
      const cell = document.createElement("span");
      cell.className = "tex-seal-cell";
      if (reduce) {
        /* Reduced motion: the truth arrives already locked, full ink. */
        cell.textContent = ch;
        cell.classList.add("is-locked", "is-deep");
      } else {
        cell.textContent = HEX[(Math.random() * 16) | 0];
      }
      row.appendChild(cell);
      return cell;
    });
    if (reduce) return undefined;

    const locked = new Array(cells.length).fill(false);
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
            cell.animate(
              [
                { transform: "translateY(3px) scale(1)" },
                { transform: "translateY(0) scale(1.04)", offset: 0.6 },
                { transform: "translateY(0) scale(1)" },
              ],
              {
                duration: SEAL_SETTLE_MS,
                easing: "cubic-bezier(0.16, 1, 0.3, 1)",
                fill: "both",
              }
            );
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
  }, [hash]);

  /* The cells are theatre; the accessible name is the plain truth. */
  return <p className="tex-seal-anchor" ref={rowRef} aria-label={hash} />;
}
