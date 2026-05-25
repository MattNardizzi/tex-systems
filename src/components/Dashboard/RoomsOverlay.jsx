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

  const rooms = [
    {
      key: "discovery",
      label: "Discovery",
      line: "I'm watching eighty-three agents across your stack.",
    },
    {
      key: "identity",
      label: "Identity",
      line: "All eighty-three are who they say they are.",
    },
    {
      key: "observability",
      label: "Observability",
      line: "Nothing has drifted this week.",
    },
    {
      key: "execution",
      label: "Execution",
      line: "I allowed four thousand eight hundred sixteen, held ten, stopped one.",
    },
    {
      key: "evidence",
      label: "Evidence",
      line: "Every decision sealed and chained. Ready when you need them.",
    },
    {
      key: "evolution",
      label: "Evolution",
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
        <p className="tex-rooms-eyebrow">The rooms</p>

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
