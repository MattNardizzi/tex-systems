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
 * Earlier drafts had three machine facts here (LAST DECISION · Ns AGO ·
 * EVIDENCE ON FILE). They were honest but they competed with the line
 * above. The line is the point. The pulse is the proof of life. Anything
 * else is the dashboard sneaking back in.
 *
 * In production the count and timestamp come from the API. The mock
 * values below keep the surface honest: a large count, a recent tick.
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

        {/* One pulse, not three facts. The orb is already saying alive;
            the sentence is already saying working. This is just the
            tick of a wristwatch you weren't watching but trust. */}
        <p className="tex-quiet-pulse">
          <span className="tex-quiet-pulse-dot" aria-hidden="true" />
          {secondsAgo}s
        </p>
      </div>
    </div>
  );
}
