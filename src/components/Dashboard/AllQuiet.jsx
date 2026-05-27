import { useEffect, useState } from "react";
import Orb from "./Orb";
import "./AllQuiet.css";

/**
 * AllQuiet — the resting state.
 *
 * The orb breathes. Below it, one serif italic sentence — Tex stating
 * what it's been doing while you weren't watching. Below that, a single
 * small pulse: a soft dot and "Ns" — the wristwatch tick of a system
 * you trust without checking.
 *
 * The orb is the door into the rooms. Click it (or press Enter / Space
 * while it has focus) to walk in. The cursor changes on hover. A faint
 * outer ring brightens. That's the affordance. No pill, no menu, no
 * "click here" — the orb is the only thing that asks to be touched, so
 * touching it is what works.
 *
 * First-visit cue: about 2s after the orb settles, a single soft ring
 * releases outward and the words "touch tex" fade in below the sentence
 * for ~2s, then fade out. Stored in localStorage so it never returns on
 * this device. Teach once. Trust thereafter.
 *
 * In production the count and timestamp come from the API. The mock
 * values below keep the surface honest: a large count, a recent tick.
 */
const CUE_KEY = "tex.taught.touch";

export default function AllQuiet({ onOpenRooms = () => {} }) {
  // Live ticker so the seconds count up. The dashboard feels alive
  // even when nothing else is happening.
  const [secondsAgo, setSecondsAgo] = useState(14);

  // First-visit cue. Three stages: hidden → showing → gone forever.
  // We use a single "phase" string so the CSS can drive both the
  // ring release and the words "touch tex" off one source of truth.
  const [cuePhase, setCuePhase] = useState("hidden");

  useEffect(() => {
    const id = setInterval(() => setSecondsAgo((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Show the cue at most once per device. If localStorage isn't
    // available (private mode, SSR), we err on the side of silence
    // — better to never teach than to teach repeatedly.
    let taught = "1";
    try {
      taught = window.localStorage.getItem(CUE_KEY);
    } catch {
      taught = "1";
    }
    if (taught) return;

    const t1 = setTimeout(() => setCuePhase("showing"), 1800);
    const t2 = setTimeout(() => setCuePhase("gone"), 4200);
    const t3 = setTimeout(() => {
      try {
        window.localStorage.setItem(CUE_KEY, "1");
      } catch {}
    }, 4500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const handleOrbKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenRooms();
    }
  };

  const actionsToday = 4827;
  const cueVisible = cuePhase === "showing";

  return (
    <div className="tex-quiet">
      <div className="tex-quiet-stage">
        {/* Orb wrapped in a button. The orb itself stays purely
            presentational; the button adds the affordance without
            changing what the orb looks like. */}
        <button
          type="button"
          className={`tex-quiet-orb${cueVisible ? " is-cueing" : ""}`}
          onClick={onOpenRooms}
          onKeyDown={handleOrbKey}
          aria-label="Open the rooms"
        >
          <Orb state="quiet" size="lg" />
        </button>

        <p className="tex-quiet-line">
          I let <span className="tex-quiet-count">{actionsToday.toLocaleString()}</span> through today.
          <em> None needed you.</em>
        </p>

        {/* One pulse, not three facts. The orb is already saying alive;
            the sentence is already saying working. This is just the
            tick of a wristwatch you weren't watching but trust. */}
        <p className="tex-quiet-pulse">
          <span className="tex-quiet-pulse-dot" aria-hidden="true" />
          {secondsAgo}s
        </p>

        {/* First-visit cue. The element is always rendered after the
            cue starts so the fade-out can play; visibility is owned by
            the data-phase attribute so CSS handles in/out as one rule. */}
        {cuePhase !== "hidden" && (
          <p
            className="tex-quiet-cue"
            data-phase={cuePhase}
            aria-hidden="true"
          >
            touch tex
          </p>
        )}
      </div>
    </div>
  );
}
