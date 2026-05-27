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
 * the orb itself, never from the room.
 *
 * Navigation is two gestures, no more:
 *   - touch the orb (in AllQuiet) → walk into the rooms
 *   - press the T mark (any state) → return home to the dashboard
 *
 * There is no bottom-right pill. There is no menu. The orb is the
 * door. The T is the way home. Two gestures, taught once, used
 * forever. That's the whole vocabulary.
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

  // The T always returns home: close the rooms, leave AsksYou alone
  // (the user closes that with Got it / Show me, not by going home).
  const handleHome = () => {
    setRoomsOpen(false);
  };

  return (
    <div className="tex-shell">
      <TopBar
        initial={initial}
        hidePresence={asking || roomsOpen}
        onHome={handleHome}
      />

      <main className="tex-body">
        {asking ? (
          <AsksYou
            decision={decision}
            onShowMe={onShowMe}
            onThanks={onThanks}
          />
        ) : (
          <AllQuiet onOpenRooms={() => setRoomsOpen(true)} />
        )}
      </main>

      <RoomsOverlay
        open={roomsOpen}
        onClose={() => setRoomsOpen(false)}
        onOpenRoom={onOpenRoom}
      />
    </div>
  );
}
