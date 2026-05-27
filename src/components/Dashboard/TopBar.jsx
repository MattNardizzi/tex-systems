import "./TopBar.css";

/**
 * TopBar — three objects. The persistent chrome.
 *   left:   T mark — clickable, returns home from anywhere
 *   center: "Tex is here" with the breathing dot
 *   right:  user initial avatar
 *
 * The T is the home gesture. It is the only home gesture. Press T
 * from any state — AllQuiet, AsksYou, inside the rooms, inside a
 * room interior — and you return to the dashboard at rest. One way
 * home. Like the iPhone home button before they took it away.
 *
 * On the asking state the center label hides — the orb itself is
 * the presence indicator at that point. The avatar stays. The T
 * stays. Especially the T — that's the way out.
 */
export default function TopBar({
  initial = "M",
  hidePresence = false,
  onHome = () => {},
}) {
  return (
    <header className="tex-topbar">
      <div className="tex-topbar-left">
        <button
          type="button"
          className="tex-mark"
          aria-label="Home"
          onClick={onHome}
        >
          T
        </button>
      </div>

      <div className="tex-topbar-center">
        {!hidePresence && (
          <div className="tex-presence" role="status" aria-live="polite">
            <span className="tex-presence-dot" aria-hidden="true">
              <span className="tex-presence-dot-core" />
            </span>
            <span className="tex-presence-label">Tex is here</span>
          </div>
        )}
      </div>

      <div className="tex-topbar-right">
        <button type="button" className="tex-avatar" aria-label="Account">
          {initial}
        </button>
      </div>
    </header>
  );
}
