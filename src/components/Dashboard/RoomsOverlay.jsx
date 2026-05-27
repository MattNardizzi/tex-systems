import { useCallback, useEffect, useRef, useState } from "react";
import "./RoomsOverlay.css";

/**
 * RoomsOverlay — six rooms, one screen each.
 *
 * The six rooms are Tex's day, in the order Tex lives it. They map
 * one-to-one onto the six layers of the backend:
 *
 *   1. discovery  — Tex finds the agents
 *   2. identity   — Tex knows who they are
 *   3. monitoring — Tex watches them
 *   4. execution  — Tex makes the call
 *   5. evidence   — Tex seals the proof
 *   6. learning   — Tex asks permission to grow
 *
 * Each room has the same anatomy:
 *
 *   - one sentence (Tex's voice, serif italic, clickable — the door
 *     to the room's interior)
 *   - one small proof label below the sentence (upright sans, lowercase,
 *     muted — the back of the fence)
 *   - the position dots
 *   - the exit line: "want me to do this for your agents?" — same
 *     words, same weight, same position in every room
 *
 * Entered by touching the orb. Exited by the X (top-right) or by
 * pressing the T mark (handled by the parent). Inside, the user moves
 * between rooms with wheel, two-finger swipe, arrow keys, page keys,
 * space, touch swipe, or by clicking a dot.
 */
const ROOMS_CUE_KEY = "tex.taught.rooms";

const ROOMS = [
  {
    key: "discovery",
    line: "I found eighty-three agents in your environment this week. Two were new. One had gone quiet.",
    proof: "discovery — 83 found · 2 new · 1 quiet",
  },
  {
    key: "identity",
    line: "All of them are who they say they are. One asked for more than I'd given it. I held the line.",
    proof: "identity — 83 verified · 1 boundary held",
  },
  {
    key: "monitoring",
    line: "I'm watching them all, right now. Nothing is drifting. I'll tell you the moment something does.",
    proof: "monitoring — 83 watched · 0 drifting",
  },
  {
    key: "execution",
    line: "I made 4,827 decisions today. I allowed 4,826. I stopped one.",
    proof: "execution — 4,827 evaluated · 1 stopped",
  },
  {
    key: "evidence",
    line: "I wrote it all down. If anyone ever asks, I can prove it.",
    proof: "evidence — every decision sealed · chain intact",
  },
  {
    key: "learning",
    line: "I've learned two things this week. I'd like your sign-off before I use them.",
    proof: "learning — 2 proposals pending your review",
  },
];

export default function RoomsOverlay({ open, onClose, onOpenRoom = () => {} }) {
  const [index, setIndex] = useState(0);

  // First-visit cue: teaches that the sentence is clickable. Fires
  // once per device, then never again.
  const [cuePhase, setCuePhase] = useState("hidden");

  // Wheel/swipe debounce — without this a single trackpad swipe fires
  // dozens of wheel events and the user blows through every room in
  // one gesture. One input per ~600ms.
  const lockedUntil = useRef(0);
  const touchStartY = useRef(null);
  const touchStartX = useRef(null);

  const advance = useCallback((delta) => {
    const now = Date.now();
    if (now < lockedUntil.current) return;
    setIndex((i) => {
      const next = Math.min(ROOMS.length - 1, Math.max(0, i + delta));
      if (next !== i) lockedUntil.current = now + 600;
      return next;
    });
  }, []);

  // Reset to room 0 each time the overlay opens — walking through a
  // door, not resuming a tab.
  useEffect(() => {
    if (open) {
      setIndex(0);
      lockedUntil.current = Date.now() + 400;
    }
  }, [open]);

  // First-visit cue inside the rooms. Fires once, ~1.5s after the
  // overlay opens on a brand-new device.
  useEffect(() => {
    if (!open) return;

    let taught = "1";
    try {
      taught = window.localStorage.getItem(ROOMS_CUE_KEY);
    } catch {
      taught = "1";
    }
    if (taught) return;

    const t1 = setTimeout(() => setCuePhase("showing"), 1500);
    const t2 = setTimeout(() => setCuePhase("gone"), 3900);
    const t3 = setTimeout(() => {
      try {
        window.localStorage.setItem(ROOMS_CUE_KEY, "1");
      } catch {}
    }, 4200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      setCuePhase("hidden");
    };
  }, [open]);

  // Keyboard. Attached to window so the user can press keys without
  // first clicking somewhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        advance(+1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
        e.preventDefault();
        advance(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, advance, onClose]);

  if (!open) return null;

  // Wheel — both vertical scroll and trackpad horizontal advance one
  // room. The debounce in advance() keeps a single gesture from
  // skipping multiple rooms.
  const handleWheel = (e) => {
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 12) return;
    advance(d > 0 ? +1 : -1);
  };

  const handleTouchStart = (e) => {
    const t = e.touches[0];
    touchStartY.current = t.clientY;
    touchStartX.current = t.clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStartY.current == null) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - touchStartY.current;
    const dx = t.clientX - touchStartX.current;
    const useY = Math.abs(dy) > Math.abs(dx);
    const d = useY ? dy : dx;
    if (Math.abs(d) < 40) return;
    // Natural direction: swipe up / left → next room.
    advance(d < 0 ? +1 : -1);
    touchStartY.current = null;
    touchStartX.current = null;
  };

  const current = ROOMS[index];

  return (
    <div
      className="tex-rooms-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Rooms"
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Close — top right. The T (top left) also returns home but is
          owned by the parent's TopBar so it persists across all states.
          This X is specific to the rooms overlay. */}
      <button
        type="button"
        className="tex-rooms-close"
        onClick={onClose}
        aria-label="Close"
      >
        <span aria-hidden="true">×</span>
      </button>

      <div className="tex-rooms-stage">
        {/* The sentence is the room. Clicking it opens the interior
            (handled by onOpenRoom in the parent). */}
        <button
          type="button"
          className="tex-rooms-sentence"
          onClick={() => onOpenRoom(current.key)}
          key={current.key} /* re-key so the arrival animation replays */
        >
          {current.line}
        </button>

        {/* Proof label — small upright sans, lowercase, muted. The
            back of the fence. Confirmation, not declaration. */}
        <p className="tex-rooms-proof" key={`${current.key}-proof`}>
          {current.proof}
        </p>

        {/* First-visit cue: "tap to look closer" — fires once, on
            whichever room the user lands on first. */}
        {cuePhase !== "hidden" && index === 0 && (
          <p
            className="tex-rooms-cue"
            data-phase={cuePhase}
            aria-hidden="true"
          >
            tap to look closer
          </p>
        )}

        {/* Position dots. Six now, one per layer. The current one
            filled, the others outline. Clickable to jump. */}
        <div className="tex-rooms-dots" role="tablist" aria-label="Rooms">
          {ROOMS.map((r, i) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={r.key}
              className={`tex-rooms-dot${i === index ? " is-current" : ""}`}
              onClick={() => {
                lockedUntil.current = Date.now() + 400;
                setIndex(i);
              }}
            />
          ))}
        </div>
      </div>

      {/* The exit. Same words, same place, same weight in every room.
          The visitor can leave the story at whichever room moved them.
          The conversion mechanic is invisible because it's identical
          everywhere — they only notice it when they're ready. */}
      <a
        className="tex-rooms-exit"
        href="https://calendly.com/matthewnardizzi/tex"
        target="_blank"
        rel="noreferrer noopener"
      >
        want me to do this for your agents?
      </a>
    </div>
  );
}
