import Vigil from "./Vigil";
import "./Dashboard.css";

/**
 * Dashboard — the entire product surface.
 *
 * There is no chrome. There used to be a TopBar — a T mark in the
 * corner as a way home, an avatar on the right. Both are gone. The T
 * is never a static logo sitting in a corner; it is the living mark,
 * center stage, breathing. A second, frozen T would be a face caught
 * mid-expression — a lie. So there is one T, and it is the product.
 *
 * The vigil owns the whole screen. One mark, three breath states, one
 * voice you reach by holding it. Nothing else.
 */
export default function Dashboard() {
  return (
    <div className="tex-shell">
      <main className="tex-body tex-body--bare">
        <Vigil />
      </main>
    </div>
  );
}
