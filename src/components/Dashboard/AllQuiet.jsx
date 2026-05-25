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
            fontSize={104}
            letterSpacing={-4}
            width={520}
            height={140}
            baseline={104}
          />
        </div>
      </div>
    </div>
  );
}
