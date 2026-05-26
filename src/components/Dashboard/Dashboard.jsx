import { useState } from "react";
import TopBar from "./TopBar";
import AllQuiet from "./AllQuiet";
import AsksYou from "./AsksYou";
import RoomsOverlay from "./RoomsOverlay";
import "./Dashboard.css";

/**
 * Dashboard — the entire product surface.
 *
 * One canvas, two states. Switched by whether `decision` is present:
 *   - decision == null → AllQuiet — Tex at rest. The orb breathes alone.
 *   - decision != null → AsksYou — Tex has stopped something. One thing.
 *
 * Pure white paper. No ambient washes. The light comes from type and
 * the orb itself, never from the room. This is the dashboard equivalent
 * of an Apple Watch face — beautiful at minute one, beautiful at hour eight.
 *
 * The six rooms live one click away in the bottom right. Not a corner
 * caption. A real pill the operator can press.
 */
export default function Dashboard({
  decision,
  initial = "M",
  onShowMe = () => {},
  onThanks = () => {},
  onOpenRoom = () => {},
}) {
  const [roomsOpen, setRoomsOpen] = useState(false);
  const asking = !!decision;

  return (
    <div className="tex-shell">
      <TopBar initial={initial} hidePresence={asking} />

      <main className="tex-body">
        {asking ? (
          <AsksYou
            decision={decision}
            onShowMe={onShowMe}
            onThanks={onThanks}
          />
        ) : (
          <AllQuiet />
        )}
      </main>

      <footer className="tex-footer">
        <button
          type="button"
          className="tex-footer-link"
          onClick={() => setRoomsOpen(true)}
        >
          The rooms
        </button>
      </footer>

      <RoomsOverlay
        open={roomsOpen}
        onClose={() => setRoomsOpen(false)}
        onOpenRoom={onOpenRoom}
      />
    </div>
  );
}
