import "./TopBar.css";

/**
 * TopBar — two objects. The persistent chrome.
 *   left:  T mark — clickable, returns home from anywhere
 *   right: user initial avatar
 *
 * The T is the home gesture. It is the only home gesture. Press T
 * from any state and you return to the vigil at rest. One way home.
 * Like the iPhone home button before they took it away.
 *
 * There used to be a "Tex is here" presence label in the center with
 * a breathing dot. Tex's presence is already carried by the voice on
 * the stage. Saying it again in the corner was the back of the book
 * describing the front of the book. Cut.
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
