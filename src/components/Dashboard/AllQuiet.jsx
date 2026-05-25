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
            text="All Quiet"
            fontSize={83}
            letterSpacing={-3.2}
            width={420}
            height={112}
            baseline={83}
          />
        </div>
      </div>
    </div>
  );
}
