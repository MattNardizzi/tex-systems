import Orb from "./Orb";
import "./AsksYou.css";

/**
 * AsksYou — the moment something needs you.
 *
 * The orb is now amber and slower. It drifts to the left of the canvas.
 * Beside it, in serif italic, Tex says one thing — a single sentence and
 * a quiet aside ("I said no.").
 *
 * Two actions, in the colleague's vocabulary:
 *   - "Show me"  — primary, dark capsule
 *   - "Thank you" — secondary, plain text
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
        <Orb state="asking" size="md" />

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
