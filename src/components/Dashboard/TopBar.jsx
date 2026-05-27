import "./TopBar.css";

/**
 * TopBar — two objects. The persistent chrome.
 *   left:  T mark — clickable, returns home from anywhere
 *   right: user initial avatar
 *
 * The T is the home gesture. It is the only home gesture. Press T
 * from any state — AllQuiet, AsksYou, inside the rooms, inside a
 * room interior — and you return to the dashboard at rest. One way
 * home. Like the iPhone home button before they took it away.
 *
 * There used to be a "Tex is here" presence label in the center
 * with a breathing dot. The orb already breathes, and the orb is
 * already saying Tex is here without using the words. Saying it in
 * the corner was the back of the book describing the front of the
 * book. Cut.
 */
export default function TopBar({ initial = "M", onHome = () => {} }) {
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

      <div className="tex-topbar-right">
        <button type="button" className="tex-avatar" aria-label="Account">
          {initial}
        </button>
      </div>
    </header>
  );
}
