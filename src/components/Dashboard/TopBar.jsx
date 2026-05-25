import "./TopBar.css";

/**
 * TopBar — three cells, the only persistent chrome on the canvas.
 *   left:   T mark (the only logo)
 *   center: "Tex is here" with a tiny breathing dot
 *   right:  user initial
 *
 * On the asking state the center label hides; the orb itself is the presence.
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
            <span className="tex-presence-dot">
              <span className="tex-presence-dot-core" />
            </span>
            <span className="tex-presence-label">Tex is here</span>
          </div>
        )}
      </div>

      <div className="tex-topbar-right">
        <div className="tex-avatar" aria-label="Account">{initial}</div>
      </div>
    </header>
  );
}
