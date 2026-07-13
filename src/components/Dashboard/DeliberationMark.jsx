/* ============================================================
   DeliberationMark — Tex thinking, rendered as fabrication.

   A single capital T in the voice register (Inter Light), built in
   layers on one SVG so the letter reads as a thing being MADE, not
   a label sitting still:

     1. ghost  — the engraved outline, faint hairline, always there:
                 the letterform exists before the ink does.
     2. echo   — T-shaped pulses radiating outward and thinning to
                 nothing: presence, sonar-quiet, letter-shaped.
     3. trace  — ink segments travelling the glyph's own edge at
                 constant machine speed: the etcher writing the T,
                 over and over, while Tex weighs the answer.
     4. ink    — the filled T breathing underneath it all.

   Everything is achromatic and every layer is the same glyph — one
   letter, four states of matter. All motion lives in CSS; reduced
   motion collapses it to the still engraved T.
   ============================================================ */
export default function DeliberationMark() {
  return (
    <svg
      className="tex-deliberation-mark"
      viewBox="0 0 160 160"
      aria-hidden="true"
    >
      <text x="80" y="80" className="tex-delib-ghost">
        T
      </text>
      <text x="80" y="80" className="tex-delib-echo">
        T
      </text>
      <text x="80" y="80" className="tex-delib-echo tex-delib-echo--late">
        T
      </text>
      <text x="80" y="80" className="tex-delib-trace">
        T
      </text>
      <text x="80" y="80" className="tex-delib-ink">
        T
      </text>
    </svg>
  );
}
