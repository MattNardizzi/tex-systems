import "./TopBar.css";

/**
 * TopBar — three objects. The persistent chrome.
 *   left:   T mark (the only logo, matches homepage)
 *   center: "Tex is here" with the breathing dot
 *   right:  user initial avatar
 *
 * On the asking state the center label hides — the orb itself is
 * the presence indicator at that point. The avatar stays.
 */
export default function TopBar({ initial = "M", hidePresence = false }) {
  return (
    <header className="tex-topbar">
      <div className="tex-topbar-left">
        <div className="tex-mark" aria-label="Tex">T</div>
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
