import { useRef } from "react";
import TopBar from "./TopBar";
import Vigil from "./Vigil";
import "./Dashboard.css";

/**
 * Dashboard — the entire product surface.
 *
 * One canvas. One voice. Three depths.
 *
 *   TopBar          — the persistent chrome. T mark (home) + initial.
 *   Vigil           — the door, the briefing, the proof. All on one
 *                     stage, dissolving into one another.
 *
 * There is no scroll. There are no rooms. There is no overlay.
 * Tex is talking. The operator is listening. When the operator
 * wants to look closer at a sentence, the sentence opens in place.
 * When the operator presses the T, Tex starts over from the door.
 *
 * That is the whole vocabulary.
 */
export default function Dashboard({ initial = "M" }) {
  /* The T mark resets the vigil. We expose a registration callback
     to the Vigil component so it can install its own reset handler.
     This keeps pacing logic where pacing lives. */
  const homeHandler = useRef(() => {});

  const registerHome = (fn) => {
    homeHandler.current = fn;
  };

  const handleHome = () => {
    homeHandler.current();
  };

  return (
    <div className="tex-shell">
      <TopBar initial={initial} onHome={handleHome} />

      <main className="tex-body">
        <Vigil onHomeRequested={registerHome} />
      </main>
    </div>
  );
}
