import Vigil from "./Vigil";
import "./Dashboard.css";

/**
 * Dashboard — the entire product surface.
 *
 * There is no chrome. There is no mark. The surface at rest is empty
 * white — no logo, no breathing letter, no pilot light. Tex does not
 * post a sign of life; you know it is alive because it answers when you
 * reach. The vigil owns the whole screen: silence at rest, one voice you
 * reach by holding anywhere, and the two things worth breaking silence
 * for — a held decision, or a broken chain. Nothing else.
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
