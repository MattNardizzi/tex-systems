import { memo } from "react";

/* SpokenLine — a line of Tex's words that light up in step with its voice.
 *
 * `active` is the index of the word Tex is currently speaking (0-based, split on
 * whitespace — the SAME split the backend uses for /v1/speak/timed word timing,
 * so the indices line up). -1 means no active highlight: every word renders at
 * full ink and the line is identical to plain text — which is exactly what the
 * fallback voice (local Kokoro, no timing) and the FINISHED answer want.
 *
 * A value of -2 or less is the PENDING sentinel: the line has mounted but the
 * voice has not begun, so EVERY word (word 0 included) sits faint. This lets an
 * answer reveal strictly FORWARD — faint until the voice reaches each word —
 * instead of mounting full-bright and then dimming its own unspoken tail the
 * instant word 0 lights (a reverse-ink flash). It renders the EXACT text it is
 * given; it never authors or edits a word. The words ahead of the voice sit
 * faint (`.tex-word.is-ahead`) and brighten as Tex reaches them — ink filling in.
 *
 * Memoized: the audio clock ticks `active` several times a second, and this is
 * the ONLY leaf whose word index changes — so the per-word tick reconciles this
 * speaking subtree alone, never the surrounding chrome.
 */
function SpokenLine({ text, active = -1, className }) {
  const tokens = String(text ?? "").split(/(\s+)/);
  const pending = active <= -2; /* mounted, not yet voiced — hold every word faint */
  let word = -1;
  return (
    <span className={className}>
      {tokens.map((tok, i) => {
        if (tok === "") return null;
        if (/^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
        word += 1;
        const ahead = pending || (active >= 0 && word > active);
        return (
          <span key={i} className={ahead ? "tex-word is-ahead" : "tex-word"}>
            {tok}
          </span>
        );
      })}
    </span>
  );
}

export default memo(SpokenLine);
