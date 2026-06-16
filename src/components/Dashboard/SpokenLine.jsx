/* SpokenLine — a line of Tex's words that light up in step with its voice.
 *
 * `active` is the index of the word Tex is currently speaking (0-based, split on
 * whitespace — the SAME split the backend uses for /v1/speak/timed word timing,
 * so the indices line up). -1 means no active highlight: every word renders at
 * full ink and the line is identical to plain text — which is exactly what the
 * fallback voice (local Kokoro, no timing) and the pre-audio state want.
 *
 * It renders the EXACT text it is given; it never authors or edits a word. The
 * words ahead of the voice sit faint (`.tex-word.is-ahead`) and brighten as Tex
 * reaches them — ink filling in.
 */
export default function SpokenLine({ text, active = -1, className }) {
  const tokens = String(text ?? "").split(/(\s+)/);
  let word = -1;
  return (
    <span className={className}>
      {tokens.map((tok, i) => {
        if (tok === "") return null;
        if (/^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
        word += 1;
        const ahead = active >= 0 && word > active;
        return (
          <span key={i} className={ahead ? "tex-word is-ahead" : "tex-word"}>
            {tok}
          </span>
        );
      })}
    </span>
  );
}
