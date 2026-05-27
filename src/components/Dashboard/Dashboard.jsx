import { useRef, useState } from "react";
import TopBar from "./TopBar";
import Vigil from "./Vigil";
import "./Dashboard.css";

/**
 * Dashboard — the entire product surface.
 *
 *   TopBar   — the persistent chrome. T mark (home) + initial avatar.
 *              Hidden during the manifesto; appears for the first time
 *              at the moment the vigil begins on day one. Persistent
 *              thereafter.
 *
 *   Vigil    — the door (manifesto on day one, threshold on day two
 *              onward), the vigil, the proof. All on one stage,
 *              dissolving into one another.
 *
 * There is no scroll. There are no rooms. There is no overlay. Tex is
 * talking. The operator is listening. When the operator wants to look
 * closer at a sentence, the sentence opens in place. When the operator
 * presses the T, Tex returns to the start of the vigil. The T mark
 * never replays the manifesto — that is, by design, an unrepeatable
 * event.
 */
export default function Dashboard({ initial = "M" }) {
  /* The T mark resets the vigil. We expose a registration callback so
     the Vigil component can install its own reset handler. */
  const homeHandler = useRef(() => {});
  const registerHome = (fn) => {
    homeHandler.current = fn;
  };
  const handleHome = () => homeHandler.current();

  /* Chrome visibility — driven by Vigil so the topbar can hide during
     the manifesto and during the held blackout between manifesto and
     vigil. Default false so day-one operators don't see the chrome
     flash for a frame before Vigil reports back. */
  const [chromeVisible, setChromeVisible] = useState(false);

  return (
    <div className="tex-shell">
      {chromeVisible && (
        <TopBar initial={initial} onHome={handleHome} />
      )}

      <main className={`tex-body${chromeVisible ? "" : " tex-body--bare"}`}>
        <Vigil
          onHomeRequested={registerHome}
          onChromeReady={setChromeVisible}
        />
      </main>
    </div>
  );
}
