import { useEffect } from "react";
import "./RoomsOverlay.css";

/**
 * RoomsOverlay — the six rooms, behind a single gesture.
 *
 * The dashboard's only persistent affordance to navigation. Each room is
 * a sentence Tex says in the first person, not a label. Press the room
 * to walk into it. Press Escape or the canvas to leave.
 */
export default function RoomsOverlay({ open, onClose, onOpenRoom = () => {} }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Four rooms, not six. Discovery and Identity are one thought — what's
  // out there, and who they really are. Observability is folded into the
  // single sentence that matters, "nothing has drifted." The result is
  // four sentences you can hold in your head at once, the way you'd hold
  // four chapters of a book — not six tabs on a screen.
  const rooms = [
    {
      key: "watch",
      label: "Watch",
      line: "I'm watching eighty-three agents. All of them are who they say they are.",
    },
    {
      key: "execution",
      label: "Execution",
      line: "I allowed four thousand eight hundred sixteen today. I stopped one.",
    },
    {
      key: "evidence",
      label: "Evidence",
      line: "Every decision sealed. Ready when you need them.",
    },
    {
      key: "learning",
      label: "Learning",
      line: "I've learned two things this week. I'd like your sign-off before I use them.",
    },
  ];

  return (
    <div
      className="tex-rooms-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Rooms"
      onClick={onClose}
    >
      <div
        className="tex-rooms-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="tex-rooms-eyebrow">the rooms</p>

        <ul className="tex-rooms-list">
          {rooms.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                className="tex-rooms-item"
                onClick={() => {
                  onOpenRoom(r.key);
                  onClose();
                }}
              >
                <span className="tex-rooms-label">{r.label}</span>
                <span className="tex-rooms-line">{r.line}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
