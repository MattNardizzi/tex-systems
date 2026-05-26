import { useEffect, useState } from "react";
import Orb from "./Orb";
import "./AllQuiet.css";

/**
 * AllQuiet — the resting state.
 *
 * The orb breathes. Below it, one serif italic sentence — Tex stating
 * what it's been doing while you weren't watching. Below that, a small
 * Inter heartbeat line: live action count and how long since the last
 * one. The heartbeat is the dashboard equivalent of a clock on a lock
 * screen — the thing that tells the operator the system is alive at
 * 8:47am on a Tuesday.
 *
 * No "All Quiet" word. That's a poster word, not a working sentence.
 * The dashboard at rest must demonstrate Tex is working — not label
 * the absence of an alarm.
 *
 * In production these numbers come from the API. The mock values below
 * keep the surface honest: a large count, a recent timestamp.
 */
export default function AllQuiet() {
  // Live ticker so the seconds count up. The dashboard feels alive
  // even when nothing else is happening.
  const [secondsAgo, setSecondsAgo] = useState(14);

  useEffect(() => {
    const id = setInterval(() => setSecondsAgo((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const actionsToday = 4827;

  return (
    <div className="tex-quiet">
      <div className="tex-quiet-stage">
        <div className="tex-quiet-orb">
          <Orb state="quiet" size="lg" />
        </div>

        <p className="tex-quiet-line">
          I let <span className="tex-quiet-count">{actionsToday.toLocaleString()}</span> through today.
          <em> None needed you.</em>
        </p>

        <p className="tex-quiet-heartbeat">
          LAST DECISION · {secondsAgo}s AGO · EVIDENCE ON FILE
        </p>
      </div>
    </div>
  );
}
