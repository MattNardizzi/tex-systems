import "./Orb.css";

/**
 * Orb — the breathing presence at the center of Tex.
 *
 * Two states only:
 *   - "quiet"  : cool blue-gray halo, slow rhythm. Nothing needs you.
 *   - "asking" : warm amber halo, slower rhythm. One thing needs you.
 *
 * The color is lifted directly from the "Absolute." word on the marketing
 * site — the same #F4F6FA → #C8D2DE → #5B6E84 → #1D2733 axis, expressed
 * as concentric halos around a small glass core.
 */
export default function Orb({ state = "quiet", size = "lg" }) {
  return (
    <div
      className={`tex-orb tex-orb--${state} tex-orb--${size}`}
      aria-hidden="true"
    >
      <div className="tex-orb-halo-outer" />
      <div className="tex-orb-halo-mid" />
      <div className="tex-orb-ring" />
      <div className="tex-orb-halo-inner" />
      <div className="tex-orb-core" />
    </div>
  );
}
