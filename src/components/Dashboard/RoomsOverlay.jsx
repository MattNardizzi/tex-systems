import { useCallback, useEffect, useState } from "react";
import "./RoomsOverlay.css";

/**
 * RoomsOverlay — four rooms, one at a time.
 *
 * Earlier this was a list: four labels with four italic sentences stacked
 * down the page. A magazine table of contents. Useful, but it read instead
 * of speaking — and Tex is supposed to speak.
 *
 * The fix is structural, not cosmetic. You don't see four rooms at once
 * anymore. You walk into one. The sentence sits centered the way the home
 * screen sentence sits centered, in the same serif italic, in the same
 * silence. Below it, a row of four tiny marks tells you which room you're
 * in and lets you step to the next.
 *
 * The result: each room feels like a place, not an entry. The same trick
 * a slideshow plays that a contact sheet can't.
 *
 * Movement: ← → arrow keys, click a mark, or click "next" on hover.
 * Exit: Escape, or the close gesture at the top-right.
 */
export default function RoomsOverlay({ open, onClose, onOpenRoom = () => {} }) {
  // The four rooms. Each is one sentence in Tex's voice. The eyebrow is
  // small and quiet — it tells you what *kind* of room without competing
  // with what Tex is saying inside it.
  //
  // Order matters. Watch first — who's out there. Then Execution — what
  // they did. Then Evidence — what's on file. Then Learning — the only
  // room that asks something of you, which is why it lives last: it's
  // the door that costs more to walk into than the others.
  const rooms = [
    {
      key: "watch",
      label: "Watch",
      line: "I'm watching eighty-three agents.",
      aside: "All of them are who they say they are.",
    },
    {
      key: "execution",
      label: "Execution",
      line: "I allowed four thousand eight hundred sixteen today.",
      aside: "I stopped one.",
    },
    {
      key: "evidence",
      label: "Evidence",
      line: "Every decision sealed.",
      aside: "Ready when you need them.",
    },
    {
      key: "learning",
      label: "Learning",
      line: "I've learned two things this week.",
      aside: "I'd like your sign-off before I use them.",
    },
  ];

  const [index, setIndex] = useState(0);
  const room = rooms[index];

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % rooms.length);
  }, [rooms.length]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + rooms.length) % rooms.length);
  }, [rooms.length]);

  // Reset to the first room each time the overlay opens. You always
  // walk in through the same door; the order is the order.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, goNext, goPrev]);

  if (!open) return null;

  return (
    <div
      className="tex-rooms"
      role="dialog"
      aria-modal="true"
      aria-label="Rooms"
      onClick={onClose}
    >
      {/* Top-right close — a single character, no chrome */}
      <button
        type="button"
        className="tex-rooms-close"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>

      <div
        className="tex-rooms-stage"
        onClick={(e) => e.stopPropagation()}
      >
        {/* The room itself — keyed so a fresh node animates in
            whenever you step. Same fade-rise the home screen uses. */}
        <article key={room.key} className="tex-rooms-room">
          <p className="tex-rooms-eyebrow">{room.label.toLowerCase()}</p>

          <p className="tex-rooms-line">
            {room.line}{" "}
            <em className="tex-rooms-aside">{room.aside}</em>
          </p>

          <button
            type="button"
            className="tex-rooms-enter"
            onClick={() => {
              onOpenRoom(room.key);
              onClose();
            }}
          >
            Walk in
          </button>
        </article>

        {/* Four marks. Active one is a filled dot; others are a hairline.
            Click jumps to that room. No "tab bar" — these don't pretend
            to be navigation. They're a place indicator. */}
        <nav className="tex-rooms-marks" aria-label="Rooms">
          {rooms.map((r, i) => (
            <button
              key={r.key}
              type="button"
              className={
                "tex-rooms-mark" + (i === index ? " is-active" : "")
              }
              aria-label={r.label}
              aria-current={i === index ? "true" : undefined}
              onClick={() => setIndex(i)}
            />
          ))}
        </nav>
      </div>
    </div>
  );
}
