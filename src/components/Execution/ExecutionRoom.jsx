import { useState } from "react";
import {
  House,
  MagnifyingGlass,
  UserCircle,
  ChartLine,
  ClockCounterClockwise,
  FileText,
  PlusCircle,
  Microphone,
} from "@phosphor-icons/react";
import "./ExecutionRoom.css";

/**
 * ExecutionRoom — Tex motherboard
 *
 * The home of the governance system. Six rooms, one canvas.
 * The colleague's report up top, the six rooms below.
 */
export default function ExecutionRoom({
  stats = { decisionsThisHour: 4827, needsYou: 1 },
  onAsk = () => {},
  onSearch = () => {},
  onOpenRoom = () => {},
  activeLayer = "home",
}) {
  const [askValue, setAskValue] = useState("");
  const [askFocused, setAskFocused] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const handleAskSubmit = (e) => {
    e.preventDefault();
    if (askValue.trim()) {
      onAsk(askValue.trim());
      setAskValue("");
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchValue.trim()) {
      onSearch(searchValue.trim());
    }
  };

  // The six rooms. Sentences a CEO would say, in the colleague's voice.
  const rooms = [
    {
      key: "stats",
      name: "Stats",
      line: "At a glance.",
    },
    {
      key: "today",
      name: "Today",
      line: "4,827 handled. One needs you.",
      dot: "coral",
    },
    {
      key: "week",
      name: "This week",
      line: "Clean. Three worth your attention.",
    },
    {
      key: "month",
      name: "This month",
      line: "On track. Audit in 14 days.",
    },
    {
      key: "team",
      name: "The team",
      line: "83 agents under my watch.",
    },
    {
      key: "pending",
      name: "What's pending",
      line: "Two changes waiting.",
      dot: "amber",
    },
  ];

  return (
    <div className="tex-shell">
      {/* Main canvas — no sidebar, the rooms are the navigation */}
      <main className="tex-main">
        {/* Soft ambient washes */}
        <div className="tex-wash tex-wash-blue" aria-hidden="true" />
        <div className="tex-wash tex-wash-rose" aria-hidden="true" />

        {/* Top bar: T mark · Tex is here · avatar */}
        <header className="tex-topbar">
          <div className="tex-logo">T</div>

          <div className="tex-presence" role="status" aria-live="polite">
            <span className="tex-presence-dot">
              <span className="tex-presence-dot-core" />
            </span>
            <span className="tex-presence-label">Tex is here</span>
          </div>

          <div className="tex-avatar">M</div>
        </header>

        {/* The colleague's morning report */}
        <section className="tex-header">
          <div>
            <h1 className="tex-h1">Monday morning</h1>
          </div>
          <div className="tex-header-stats">
            <div className="tex-stat-row tex-stat-row--bold">
              I handled {stats.decisionsThisHour.toLocaleString()} this hour.
            </div>
            <div className="tex-stat-row">One needs you.</div>
          </div>
        </section>

        {/* Search */}
        <form
          className={`tex-search ${searchFocused ? "tex-search--focused" : ""}`}
          onSubmit={handleSearchSubmit}
        >
          <MagnifyingGlass size={16} weight="regular" className="tex-search-icon" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search"
            className="tex-search-input"
            aria-label="Search"
          />
        </form>

        {/* The six rooms — 3 × 2 grid */}
        <div className="tex-grid" role="navigation" aria-label="Rooms">
          {rooms.map((r) => (
            <button
              key={r.key}
              type="button"
              className="tex-tile"
              onClick={() => onOpenRoom(r.key)}
            >
              {r.dot && (
                <span
                  className={`tex-tile-dot tex-tile-dot--${r.dot}`}
                  aria-hidden="true"
                />
              )}
              <span className="tex-tile-name" aria-label={r.name}>
                <TileWord text={r.name} />
              </span>
              <span className="tex-tile-line">{r.line}</span>
            </button>
          ))}
        </div>

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
          <Microphone size={14} weight="regular" className="tex-ask-mic" />
        </form>
      </main>
    </div>
  );
}

/**
 * TileWord
 * Renders the tile name in Source Serif with the same cool-steel gradient
 * used on "Absolute." on the homepage.
 */
function TileWord({ text }) {
  return (
    <svg
      className="tex-tile-glass"
      viewBox="0 0 400 80"
      preserveAspectRatio="xMinYMid meet"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`tex-tile-grad-${text.replace(/\s+/g, "-")}`}
          x1="0%"
          y1="0%"
          x2="0%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="50%" stopColor="#F4F6FA" stopOpacity="0.98" />
          <stop offset="100%" stopColor="#C8D2DE" stopOpacity="0.92" />
        </linearGradient>
      </defs>
      <text
        x="0"
        y="58"
        fontFamily="var(--tex-serif)"
        fontSize="56"
        fontWeight="400"
        letterSpacing="-1.5"
        fill={`url(#tex-tile-grad-${text.replace(/\s+/g, "-")})`}
      >
        {text}
      </text>
      <text
        x="0"
        y="58"
        fontFamily="var(--tex-serif)"
        fontSize="56"
        fontWeight="400"
        letterSpacing="-1.5"
        fill="none"
        stroke="rgba(29, 39, 51, 0.18)"
        strokeWidth="0.4"
      >
        {text}
      </text>
    </svg>
  );
}
