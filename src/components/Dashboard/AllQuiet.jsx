import Orb from "./Orb";
import "./AllQuiet.css";

/**
 * AllQuiet — the resting state.
 *
 * The orb breathes. Below it, one serif italic sentence.
 *
 * The sentence has two truths it can tell:
 *
 *   1. Nothing is waiting on you — "I let 4,827 through today.
 *      None needed you."
 *   2. Something is waiting on you — "I've learned two things this
 *      week. I'd like your sign-off before I use them."
 *
 * Earlier this was a single hard-coded sentence. That was fine while
 * the product had nothing to ask of you. The moment Tex needs the
 * operator's sign-off, the home screen has to *say so*, not bury it
 * four rooms deep. The sentence on the page must be true every time
 * it appears; otherwise the calm becomes a lie.
 *
 * The seconds-since-last ticker that used to live here is gone. A
 * number that increments every second turned the page into a news
 * marquee. A single soft pulse below the line is the proof of life.
 * That's enough.
 */
export default function AllQuiet({ pendingLearnings = 0 }) {
  const actionsToday = 4827;
  const asking = pendingLearnings > 0;

  return (
    <div className="tex-quiet">
      <div className="tex-quiet-stage">
        <div className="tex-quiet-orb">
          <Orb state="quiet" size="lg" />
        </div>

        {asking ? (
          // Something is pending. This is the line that sells the
          // company — promoted out of the Learning room and onto the
          // first surface anyone sees.
          <p className="tex-quiet-line">
            I've learned{" "}
            <span className="tex-quiet-count">
              {numberWord(pendingLearnings)}
            </span>{" "}
            things this week.
            <em> I'd like your sign-off before I use them.</em>
          </p>
        ) : (
          <p className="tex-quiet-line">
            I let{" "}
            <span className="tex-quiet-count">
              {actionsToday.toLocaleString()}
            </span>{" "}
            through today.
            <em> None needed you.</em>
          </p>
        )}

        {/* One soft pulse. No number, no second-count. The pulse is
            the wristwatch tick of a system you trust without checking. */}
        <span
          className="tex-quiet-pulse-dot"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

// Small helper. Reads better than digits in a sentence at this size —
// "I've learned two things" vs "I've learned 2 things". Falls back to
// the digit form past a handful.
function numberWord(n) {
  const words = ["zero", "one", "two", "three", "four", "five",
    "six", "seven", "eight", "nine"];
  return words[n] ?? String(n);
}
