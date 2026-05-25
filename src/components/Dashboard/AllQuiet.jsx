import Orb from "./Orb";
import GlassWord from "./GlassWord";
import "./AllQuiet.css";

/**
 * AllQuiet — the resting state.
 * The orb breathes. The word "All quiet" sits below it in the same
 * glass treatment as "Absolute." on the marketing site.
 *
 * No buttons. No metrics. No copy. Tex is here. Nothing needs you.
 */
export default function AllQuiet() {
  return (
    <div className="tex-quiet">
      <div className="tex-quiet-stage">
        <Orb state="quiet" size="lg" />
        <div className="tex-quiet-word">
          <GlassWord
            text="All quiet"
            fontSize={42}
            letterSpacing={-1.6}
            width={240}
            height={64}
            baseline={42}
          />
        </div>
      </div>
    </div>
  );
}
