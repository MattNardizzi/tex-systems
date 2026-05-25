import { useState } from "react";
import {
  House,
  MagnifyingGlass,
  UserCircle,
  ChartLine,
  ClockCounterClockwise,
  FileText,
  PlusCircle,
} from "@phosphor-icons/react";
import "./ExecutionRoom.css";

/**
 * ExecutionRoom
 *
 * The Tex execution room — the moment a verdict needs a human.
 */
export default function ExecutionRoom({
  decision,
  stats = { decisionsThisHour: 4827, needsYou: 1 },
  onShowMe = () => {},
  onThanks = () => {},
  onAsk = () => {},
  activeLayer = "execution",
}) {
  const [askValue, setAskValue] = useState("");
  const [askFocused, setAskFocused] = useState(false);

  const handleAskSubmit = (e) => {
    e.preventDefault();
    if (askValue.trim()) {
      onAsk(askValue.trim());
      setAskValue("");
    }
  };

  const d = decision || {
    id: "c447f14b",
    summary: "Kestrel asked to wire fifty thousand dollars in your CEO's name.",
    aside: "I said no.",
    badge: "stopped",
  };

  return (
    <div className="tex-shell">
      {/* Sidebar */}
      <aside className="tex-sidebar">
        <div className="tex-logo">T</div>

        <nav className="tex-nav">
          <NavIcon title="Home" icon={House} />
          <NavIcon title="Discovery" icon={MagnifyingGlass} />
          <NavIcon title="Identity" icon={UserCircle} dotColor="amber" />
          <NavIcon title="Observability" icon={ChartLine} />
          <NavIcon
            title="Execution"
            icon={ClockCounterClockwise}
            dotColor="coral"
            active={activeLayer === "execution"}
          />
          <NavIcon title="Evidence" icon={FileText} />
          <NavIcon title="Evolution" icon={PlusCircle} dotColor="amber" />
        </nav>

        <div className="tex-avatar">M</div>
      </aside>

      {/* Main */}
      <main className="tex-main">
        {/* Soft ambient washes */}
        <div className="tex-wash tex-wash-blue" aria-hidden="true" />
        <div className="tex-wash tex-wash-rose" aria-hidden="true" />

        {/* Tex is here */}
        <div className="tex-presence" role="status" aria-live="polite">
          <span className="tex-presence-dot" />
          <span className="tex-presence-label">Tex is here</span>
        </div>

        {/* Header row */}
        <header className="tex-header">
          <div>
            <div className="tex-eyebrow">Execution</div>
            <h1 className="tex-h1">Monday morning</h1>
          </div>
          <div className="tex-header-stats">
            <div className="tex-stat-row">
              {stats.decisionsThisHour.toLocaleString()} decisions this hour
            </div>
            <div className="tex-stat-row tex-stat-row--bold">
              {stats.needsYou} needs you
            </div>
          </div>
        </header>

        {/* The card */}
        <article className="tex-card" aria-label="Decision awaiting your review">
          <span className="tex-card-edge" aria-hidden="true" />
          <span className="tex-card-dot" aria-hidden="true" />

          <p className="tex-verdict">{d.summary}</p>
          <p className="tex-aside">{d.aside}</p>

          <div className="tex-actions">
            <button
              type="button"
              className="tex-btn tex-btn--primary"
              onClick={onShowMe}
            >
              Show me
            </button>
            <button
              type="button"
              className="tex-btn tex-btn--ghost"
              onClick={onThanks}
            >
              Thank you
            </button>
          </div>
        </article>

        {/* Ask Tex */}
        <form
          className={`tex-ask ${askFocused ? "tex-ask--focused" : ""}`}
          onSubmit={handleAskSubmit}
        >
          <MagnifyingGlass size={16} weight="regular" className="tex-ask-icon" />
          <input
            type="text"
            value={askValue}
            onChange={(e) => setAskValue(e.target.value)}
            onFocus={() => setAskFocused(true)}
            onBlur={() => setAskFocused(false)}
            placeholder="Ask Tex anything"
            className="tex-ask-input"
            aria-label="Ask Tex anything"
          />
        </form>
      </main>
    </div>
  );
}

function NavIcon({ title, icon: Icon, active = false, dotColor }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={`tex-nav-item ${active ? "tex-nav-item--active" : ""}`}
    >
      <Icon size={20} weight="regular" />
      {dotColor && <span className={`tex-nav-dot tex-nav-dot--${dotColor}`} />}
    </button>
  );
}
