import Orb from "./Orb";
import "./AsksYou.css";

/**
 * AsksYou — the moment something needs you.
 *
 * Mirrors the homepage MomentSection exactly. The orb drifts left into
 * a track at ~26% from the left edge. Beside it, in serif italic, Tex
 * says one thing — the summary and a quiet aside.
 *
 * Two actions, in the colleague's vocabulary:
 *   - "Show me"   — primary, ink-black pill (opens the decision)
 *   - "Thank you" — secondary, plain text (dismisses)
 *
 * Color never panics. The orb stays blue-gray in both states; the
 * composition is what tells the operator something changed, not the
 * temperature of the room.
 */
export default function AsksYou({
  decision,
  onShowMe = () => {},
  onThanks = () => {},
}) {
  if (!decision) return null;

  return (
    <div className="tex-asks">
      <div className="tex-asks-stage">
        <div className="tex-asks-orb">
          <Orb state="asking" size="xl" />
        </div>

        <div className="tex-asks-speech">
          <p className="tex-asks-summary">{decision.summary}</p>
          {decision.aside && (
            <p className="tex-asks-aside">{decision.aside}</p>
          )}

          <div className="tex-asks-actions">
            <button
              type="button"
              className="tex-btn tex-btn--primary"
              onClick={onShowMe}
            >
              Show me
            </button>
            <button
              type="button"
              className="tex-btn tex-btn--plain"
              onClick={onThanks}
            >
              Thank you
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
