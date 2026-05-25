import { useState } from "react";
import TopBar from "./TopBar";
import AllQuiet from "./AllQuiet";
import AsksYou from "./AsksYou";
import RoomsOverlay from "./RoomsOverlay";
import "./Dashboard.css";

/**
 * Dashboard — the entire product surface.
 *
 * Two states, switched by whether `decision` is present:
 *   - decision == null → AllQuiet
 *   - decision != null → AsksYou
 *
 * One persistent gesture: a small word-link in the bottom right that
 * opens the six rooms.
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
      {/* Ambient washes — the screenshot's lavender + warm corners */}
      <div className="tex-canvas-wash tex-canvas-wash--cool" aria-hidden="true" />
      <div className="tex-canvas-wash tex-canvas-wash--warm" aria-hidden="true" />

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
