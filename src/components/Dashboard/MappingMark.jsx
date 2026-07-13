import { memo, useEffect, useRef } from "react";

/* ------------------------------------------------------------------ */
/* The nascent anchor — the mapping state's working mark. Not a         */
/* borrowed ellipsis, not a spinner: the seal a breath before it exists,*/
/* at estate scale. A run of hex cells scrambles faintly in the seal's  */
/* own voice while a read head makes ONE bounded left→right pass; cells  */
/* under the head hold steady and lift to WORKING ink (being read), then */
/* fall back to scramble as it passes. When the single pass completes    */
/* the mark holds PERFECTLY STILL at its resting state — the estate has   */
/* been taken in; now it waits (to speak the count, or for the real      */
/* anchor to lock). The run never deepens to true ink — that value is    */
/* earned only when a real anchor locks (SealAnchor). One bounded pass    */
/* is the honest physics: a quiet etched beat, never a loop tied to the   */
/* request's unknown duration. Imperative on one rAF clock, like the      */
/* seal: zero React re-renders mid-sweep.                                */
/* ------------------------------------------------------------------ */

const HEX = "0123456789abcdef";
const MAPPING_LEN = 24; /* wider than the 6-glyph deliberation, never the full 64 */
const MAPPING_TICK_MS = 90; /* scramble cadence — calm, kin to the deliberation mark */
const MAPPING_SWEEP_MS = 1100; /* ONE bounded left→right read (≤ the 1200ms ceiling), then rest */
const MAPPING_WAVE = 5; /* cells held legible under the read head */

/* Takes no props and runs its own rAF clock — a pure leaf. Memoized so a parent
   re-render (a per-word answer tick) never tears down and re-mounts its sweep. */
function MappingMark() {
  const rowRef = useRef(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    row.textContent = "";
    const cells = [];
    for (let i = 0; i < MAPPING_LEN; i += 1) {
      const cell = document.createElement("span");
      cell.className = "tex-seal-cell";
      cell.textContent = HEX[(Math.random() * 16) | 0];
      row.appendChild(cell);
      cells.push(cell);
    }
    /* Reduced motion: a still, faint fragment — no sweep, no scramble. */
    if (reduce) return undefined;

    let raf = 0;
    let alive = true;
    let start = null;
    let last = 0;

    /* Rest state: no read head, no scramble — every cell holds its last glyph. */
    const settle = () => {
      for (let i = 0; i < MAPPING_LEN; i += 1) {
        cells[i].classList.remove("is-read");
      }
    };

    const frame = (now) => {
      if (!alive) return;
      /* Hold the clock while the tab is hidden — the pass never runs unseen. */
      if (document.hidden) {
        raf = requestAnimationFrame(frame);
        return;
      }
      if (start === null) {
        start = now;
        last = now;
      }
      /* A SINGLE pass: t climbs 0→1 once and stops. No modulo, no loop — the
         sweep is bounded, never tied to the request's unknown duration. */
      const t = (now - start) / MAPPING_SWEEP_MS;
      if (t >= 1) {
        settle();
        raf = 0;
        return; /* hold still at rest — the pass is done */
      }
      const flick = now - last >= MAPPING_TICK_MS;
      if (flick) last = now;
      /* The head travels from before the first cell to past the last, so the
         pass has a natural lead-in and release — never a hard wrap. */
      const head = t * (MAPPING_LEN + MAPPING_WAVE * 2) - MAPPING_WAVE;
      for (let i = 0; i < MAPPING_LEN; i += 1) {
        const cell = cells[i];
        if (i > head - MAPPING_WAVE && i <= head) {
          /* Under the head: hold the glyph steady and lift it — being read. */
          cell.classList.add("is-read");
        } else {
          cell.classList.remove("is-read");
          if (flick && Math.random() < 0.5) {
            cell.textContent = HEX[(Math.random() * 16) | 0];
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  /* The cells are theatre; the container's status label carries the truth. */
  return (
    <p className="tex-seal-anchor tex-mapping-anchor" ref={rowRef} aria-hidden="true" />
  );
}

export default memo(MappingMark);
