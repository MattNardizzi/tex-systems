import { useCallback, useEffect, useRef, useState } from "react";
import "./RoomsOverlay.css";

/**
 * RoomsOverlay — the four rooms, one screen each.
 *
 * Entered by touching the orb. Exited by the X (top-right) or by
 * pressing the T mark (handled by the parent). Inside, the user
 * moves between rooms with:
 *   - mouse wheel
 *   - two-finger trackpad swipe
 *   - left/right or up/down arrow keys
 *   - PageUp / PageDown / Space
 *   - touch swipe on mobile
 *   - clicking a dot at the bottom
 *
 * Each room is three things and nothing else:
 *   - the sentence (Tex's voice, serif italic, CLICKABLE — it is
 *     the door to the room's interior)
 *   - the dots at the bottom (position indicator + jump-to)
 *   - the X at the top right (close)
 *
 * No eyebrow label. No "Walk in" pill. The sentence is the room
 * name and the door at the same time. The user learns this once,
 * via the first-visit cue below the first sentence they see, and
 * the lesson applies to all four rooms thereafter.
 */
const ROOMS_CUE_KEY = "tex.taught.rooms";

const ROOMS = [
  {
    key: "watch",
    line: "I'm watching eighty-three agents. All of them are who they say they are.",
  },
  {
    key: "execution",
    line: "I allowed four thousand eight hundred sixteen today. I stopped one.",
  },
  {
    key: "evidence",
    line: "Every decision sealed. Ready when you need them.",
  },
  {
    key: "learning",
    line: "I've learned two things this week. I'd like your sign-off before I use them.",
  },
];

export default function RoomsOverlay({ open, onClose, onOpenRoom = () => {} }) {
  const [index, setIndex] = useState(0);

  // First-visit cue inside the rooms: teaches that the sentence is
  // clickable. Fires once, on the first room the user lands on,
  // never repeats per device.
  const [cuePhase, setCuePhase] = useState("hidden");

  // Wheel/swipe debounce — without this, a single trackpad swipe
  // fires dozens of wheel events and the user blows through all
  // four rooms in one gesture. We accept one input per ~600ms.
  const lockedUntil = useRef(0);
  const touchStartY = useRef(null);
  const touchStartX = useRef(null);

  const advance = useCallback(
    (delta) => {
      const now = Date.now();
      if (now < lockedUntil.current) return;
      setIndex((i) => {
        const next = Math.min(ROOMS.length - 1, Math.max(0, i + delta));
        if (next !== i) lockedUntil.current = now + 600;
        return next;
      });
    },
    []
  );

  // Reset to room 0 each time the overlay opens — feels more like
  // walking through a door than picking up where you left off.
  useEffect(() => {
    if (open) {
      setIndex(0);
      lockedUntil.current = Date.now() + 400;
    }
  }, [open]);

  // First-visit cue for the rooms. Fires once, ~1.5s after the
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

  // Keyboard navigation. We attach to window so the user can press
  // keys without first clicking somewhere.
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

  // Wheel — both deltaY (vertical scroll) and deltaX (trackpad
  // horizontal) advance one room. The debounce in advance() keeps
  // a single gesture from skipping multiple rooms.
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
      {/* Close — top right. The T (top left) also returns home but
          is owned by the parent's TopBar so it persists across all
          states. This X is specific to the rooms overlay. */}
      <button
        type="button"
        className="tex-rooms-close"
        onClick={onClose}
        aria-label="Close"
      >
        <span aria-hidden="true">×</span>
      </button>

      <div className="tex-rooms-stage">
        {/* The sentence is the room. Clicking it opens the
            interior (handled by onOpenRoom in the parent). */}
        <button
          type="button"
          className="tex-rooms-sentence"
          onClick={() => onOpenRoom(current.key)}
          key={current.key} /* re-key so the arrival animation replays */
        >
          {current.line}
        </button>

        {/* First-visit cue: "tap to look closer" — fires once, on
            whichever room the user lands on first. Never repeats. */}
        {cuePhase !== "hidden" && index === 0 && (
          <p
            className="tex-rooms-cue"
            data-phase={cuePhase}
            aria-hidden="true"
          >
            tap to look closer
          </p>
        )}

        {/* Position dots — four, the current one filled, the others
            outline. Clickable to jump. Lives inside the stage so it
            belongs to the sentence, not to the viewport floor. */}
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
    </div>
  );
}
