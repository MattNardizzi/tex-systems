import { useEffect, useMemo, useRef, useState } from "react";
import "./Vigil.css";
import { useSystemState } from "../../hooks/useSystemState";
import { speak, VIGIL_LAYERS } from "../../lib/texVoice";

/* ==================================================================
   Vigil — the entire product surface.

   One screen. One voice. Three depths.

   PHASE: manifesto (day one, ever)
     Four lines arrive one at a time, slowly, on white. There is no
     chrome — no T mark, no avatar. Tex is introducing itself, and
     nothing else exists on the page. After the four hold together
     for a long beat, they dissolve into a held empty moment, and
     then the vigil begins. The first time the operator ever sees
     the T mark and avatar is at that transition. This entire phase
     happens once per account, ever. The server-side flag (or, for
     now, localStorage) records that it happened.

   PHASE: threshold (day two onward)
     The door is shorter and specific. Three sentences derived from
     last-night's state. No "I am Tex" — Tex's identity is performed
     by voice, not announced. ~8 seconds. Then a 1.5s held pause
     before the vigil begins. The T mark and avatar are visible
     from the first frame of this phase.

   PHASE: vigil
     The six layer sentences cycle, one at a time, in the same
     place, in the same size. Each holds 7.4s, then crossfades.
     Sentences are derived from /v1/system/state. The vigil does
     not end.

   PHASE: proof
     Click a sentence. The summary dissolves. Tex finishes the
     story of that one thing in the same voice. Below it, a small
     italic anchor in Tex's voice with the sealed timestamp and
     ledger position. Hover the anchor — the SHA-256 hash appears
     in monospace, the only place in the product where typography
     breaks register. After a beat of stillness, Tex returns to
     the vigil at the next sentence in sequence.

   The T mark resets to the vigil, never to the manifesto.
   Hovering anywhere pauses pacing. There are no other controls.
   ================================================================== */

/* Pacing constants — all in one place so the rhythm is easy to tune. */

/* Manifesto pacing — once per account, ever. The patience is the point. */
const MANIFESTO_FIRST_DELAY_MS = 500;
const MANIFESTO_LINE_STAGGER_MS = 4_200;
const MANIFESTO_LINE_FADE_MS = 1_400;
const MANIFESTO_HOLD_MS = 8_000;
const MANIFESTO_DISSOLVE_MS = 1_200;
const MANIFESTO_BLACKOUT_MS = 1_800;

/* Threshold pacing — day two onward. Faster. Past-tense reports. */
const THRESHOLD_FIRST_DELAY_MS = 300;
const THRESHOLD_LINE_STAGGER_MS = 2_500;
const THRESHOLD_LINE_FADE_MS = 900;
const THRESHOLD_HOLD_MS = 2_000;
const THRESHOLD_PAUSE_MS = 1_500;

/* Vigil pacing — the steady rhythm Tex lives in. */
const VIGIL_HOLD_MS = 7_400;
const CROSSFADE_MS = 700;

/* Proof pacing. */
const PROOF_RETURN_MS = 14_000;

const MANIFESTO_LINES = [
  "I am Tex.",
  "I see your agents.",
  "I decide what they can do.",
  "I keep the proof.",
];

/* Server-side flag stand-in. When the backend grows a user model with
   a seen_manifesto_at field, this becomes a fetch. Until then we keep
   the once-per-account contract locally. */
const MANIFESTO_FLAG_KEY = "tex.seen_manifesto_at";

function hasSeenManifesto() {
  try {
    return Boolean(window.localStorage.getItem(MANIFESTO_FLAG_KEY));
  } catch {
    /* If localStorage is unavailable, fail open to threshold. The
       manifesto exists to be seen at most once; never showing it
       again on a broken browser is the safer side of the contract. */
    return true;
  }
}

function markManifestoSeen() {
  try {
    window.localStorage.setItem(MANIFESTO_FLAG_KEY, new Date().toISOString());
  } catch {
    /* No-op. The next session will simply skip the manifesto too. */
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Vigil({ onHomeRequested, onChromeReady }) {
  /* The snapshot is what the voice speaks from. Null until the first
     fetch resolves; the voice module renders honest no-knowledge
     sentences while null. */
  const snapshot = useSystemState();

  /* Initial phase: the manifesto on day one, the threshold otherwise. */
  const [phase, setPhase] = useState(() =>
    hasSeenManifesto() ? "threshold" : "manifesto"
  );
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [hashVisible, setHashVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [blackout, setBlackout] = useState(false);

  const advanceTimer = useRef(null);
  const fadeTimer = useRef(null);
  const proofReturnTimer = useRef(null);
  const blackoutTimer = useRef(null);

  /* ---------------- Chrome visibility ----------------

     The chrome (T mark + avatar) is hidden during the manifesto and
     during the blackout. It first appears at the moment the vigil
     begins on day one, and is always visible from then on. */
  useEffect(() => {
    if (!onChromeReady) return;
    const showChrome = phase !== "manifesto" && !blackout;
    onChromeReady(showChrome);
  }, [phase, blackout, onChromeReady]);

  /* ---------------- T mark home ----------------

     T mark resets to the vigil, never to the manifesto. If the user
     has somehow not yet seen the manifesto and presses T anyway, we
     still send them to the vigil — pressing T is implicit consent
     that they don't want the slow introduction. */
  useEffect(() => {
    if (!onHomeRequested) return;
    onHomeRequested(() => {
      clearAll();
      if (!hasSeenManifesto()) markManifestoSeen();
      setBlackout(false);
      setPhase("vigil");
      setIndex(0);
      setLeaving(false);
      setHashVisible(false);
    });
  }, [onHomeRequested]);

  /* ---------------- Pacing ---------------- */

  const clearAll = () => {
    [advanceTimer, fadeTimer, proofReturnTimer, blackoutTimer].forEach((r) => {
      if (r.current) clearTimeout(r.current);
      r.current = null;
    });
  };

  /* Manifesto → blackout → vigil. The blackout is the ma.

     Note: the manifesto deliberately does NOT respect the paused flag.
     A once-in-a-lifetime introduction does not get interrupted by the
     operator's cursor happening to be on the page. Tex finishes
     introducing itself; only the vigil itself pauses on hover. */
  useEffect(() => {
    if (phase !== "manifesto") return;

    const arriveTotal =
      MANIFESTO_FIRST_DELAY_MS +
      3 * MANIFESTO_LINE_STAGGER_MS +
      MANIFESTO_LINE_FADE_MS;
    const dissolveAt = arriveTotal + MANIFESTO_HOLD_MS;

    advanceTimer.current = setTimeout(() => {
      setLeaving(true);
      fadeTimer.current = setTimeout(() => {
        /* Mark seen the instant the manifesto starts to dissolve. */
        markManifestoSeen();
        setLeaving(false);
        setBlackout(true);
        blackoutTimer.current = setTimeout(() => {
          setBlackout(false);
          setPhase("vigil");
          setIndex(0);
        }, MANIFESTO_BLACKOUT_MS);
      }, MANIFESTO_DISSOLVE_MS);
    }, dissolveAt);

    return clearAll;
  }, [phase]);

  /* Threshold → held pause → vigil.

     The threshold, like the manifesto, plays to completion regardless
     of hover state. It is a delivered report — Tex catching the
     operator up on what happened overnight. You don't interrupt
     someone delivering a report by leaning in to listen. Only the
     vigil itself pauses on hover. */
  useEffect(() => {
    if (phase !== "threshold") return;

    const arriveTotal =
      THRESHOLD_FIRST_DELAY_MS +
      2 * THRESHOLD_LINE_STAGGER_MS +
      THRESHOLD_LINE_FADE_MS;
    const dissolveAt = arriveTotal + THRESHOLD_HOLD_MS;

    advanceTimer.current = setTimeout(() => {
      setLeaving(true);
      fadeTimer.current = setTimeout(() => {
        setLeaving(false);
        blackoutTimer.current = setTimeout(() => {
          setPhase("vigil");
          setIndex(0);
        }, THRESHOLD_PAUSE_MS);
      }, CROSSFADE_MS);
    }, dissolveAt);

    return clearAll;
  }, [phase]);

  /* Vigil pacing. */
  useEffect(() => {
    if (phase !== "vigil") return;
    if (paused) return;

    advanceTimer.current = setTimeout(() => {
      setLeaving(true);
      fadeTimer.current = setTimeout(() => {
        setIndex((i) => (i + 1) % VIGIL_LAYERS.length);
        setLeaving(false);
      }, CROSSFADE_MS);
    }, VIGIL_HOLD_MS);

    return clearAll;
  }, [phase, index, paused]);

  /* Proof → vigil. */
  useEffect(() => {
    if (phase !== "proof") return;
    if (paused) return;

    proofReturnTimer.current = setTimeout(() => {
      setLeaving(true);
      fadeTimer.current = setTimeout(() => {
        setPhase("vigil");
        setIndex((i) => (i + 1) % VIGIL_LAYERS.length);
        setLeaving(false);
        setHashVisible(false);
      }, CROSSFADE_MS);
    }, PROOF_RETURN_MS);

    return clearAll;
  }, [phase, paused]);

  /* ---------------- Voice derivation ---------------- */

  const vigilSentences = useMemo(() => speak(snapshot), [snapshot]);

  const thresholdSentences = useMemo(() => {
    const all = speak(snapshot ?? null);
    const byKey = Object.fromEntries(all.map((x) => [x.key, x]));
    return [byKey.discovery, byKey.monitoring, byKey.execution];
  }, [snapshot]);

  const current = vigilSentences[index] ?? vigilSentences[0];
  const proofPlaceholder =
    PROOF_PLACEHOLDERS[current?.key] ?? PROOF_PLACEHOLDERS.evidence;

  /* ---------------- Interaction ---------------- */

  const handleEnter = () => setPaused(true);
  const handleLeave = () => {
    setPaused(false);
    setHashVisible(false);
  };

  const handleSentenceClick = () => {
    if (phase !== "vigil") return;
    if (leaving) return;
    clearAll();
    setLeaving(true);
    fadeTimer.current = setTimeout(() => {
      setPhase("proof");
      setLeaving(false);
    }, CROSSFADE_MS);
  };

  /* ---------------- Render ---------------- */

  const stageClass = (extra = "") =>
    `tex-vigil-stage tex-vigil-stage--${phase}${
      leaving ? " is-leaving" : ""
    }${extra ? ` ${extra}` : ""}`;

  return (
    <section
      className="tex-vigil"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {phase === "manifesto" && !blackout && (
        <div className={stageClass()} key="manifesto">
          <div className="tex-vigil-door tex-vigil-door--manifesto">
            {MANIFESTO_LINES.map((line, i) => {
              const delaySec =
                (MANIFESTO_FIRST_DELAY_MS + i * MANIFESTO_LINE_STAGGER_MS) /
                1000;
              const durationSec = MANIFESTO_LINE_FADE_MS / 1000;
              return (
                <p
                  key={i}
                  className="tex-vigil-door-line"
                  style={{
                    animationDelay: `${delaySec}s`,
                    animationDuration: `${durationSec}s`,
                  }}
                >
                  {line}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {blackout && <div className="tex-vigil-blackout" aria-hidden="true" />}

      {phase === "threshold" && (
        <div className={stageClass()} key="threshold">
          <div className="tex-vigil-door tex-vigil-door--threshold">
            {thresholdSentences.map((s, i) => {
              const delaySec =
                (THRESHOLD_FIRST_DELAY_MS + i * THRESHOLD_LINE_STAGGER_MS) /
                1000;
              const durationSec = THRESHOLD_LINE_FADE_MS / 1000;
              return (
                <p
                  key={s?.key ?? i}
                  className="tex-vigil-door-line tex-vigil-door-line--threshold"
                  style={{
                    animationDelay: `${delaySec}s`,
                    animationDuration: `${durationSec}s`,
                  }}
                >
                  <span className="tex-vigil-head">{s?.head}</span>
                  {s?.tail && (
                    <>
                      {" "}
                      <em className="tex-vigil-tail">{s.tail}</em>
                    </>
                  )}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {phase === "vigil" && current && (
        <div className={stageClass()} key={`vigil-${index}`}>
          <button
            type="button"
            className="tex-vigil-sentence"
            onClick={handleSentenceClick}
            aria-label="Look closer at this"
          >
            <span className="tex-vigil-head">{current.head}</span>
            {current.tail && (
              <>
                {" "}
                <em className="tex-vigil-tail">{current.tail}</em>
              </>
            )}
          </button>
        </div>
      )}

      {phase === "proof" && current && (
        <div className={stageClass()} key={`proof-${index}`}>
          <div className="tex-vigil-proof">
            <p className="tex-vigil-proof-line">
              <span className="tex-vigil-head">{proofPlaceholder.head}</span>{" "}
              <em className="tex-vigil-tail">{proofPlaceholder.tail}</em>
            </p>

            <button
              type="button"
              className="tex-vigil-anchor"
              onMouseEnter={() => setHashVisible(true)}
              onMouseLeave={() => setHashVisible(false)}
              onFocus={() => setHashVisible(true)}
              onBlur={() => setHashVisible(false)}
              aria-label="Show cryptographic anchor"
            >
              {proofPlaceholder.anchor}
            </button>

            <p
              className={`tex-vigil-hash${hashVisible ? " is-visible" : ""}`}
              aria-hidden={!hashVisible}
            >
              {proofPlaceholder.hash}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/* Placeholder proof prose. These exist because the backend's evidence
   chain is empty — there are no Decision records to replay yet. The
   moment the first POST /evaluate runs, this object goes away and the
   proof layer fetches real decisions by id. Until then, the shape
   stays so the layer's UX is intact. */
const PROOF_PLACEHOLDERS = {
  discovery: {
    head: "When I find one, I'll tell you who it is, where I found it, and what it can already reach.",
    tail: "Until then, the ledger waits.",
    anchor: "ledger empty · ready to record",
    hash: "—",
  },
  identity: {
    head: "When an agent asks for more than I've given it, I will name what it asked for and what I said back.",
    tail: "I will not blur the line for any of them.",
    anchor: "no identity holds yet",
    hash: "—",
  },
  monitoring: {
    head: "I'm watching for changes in how every agent behaves.",
    tail: "When something moves, I will name what moved and when.",
    anchor: "watching · 0 events",
    hash: "—",
  },
  execution: {
    head: "Every decision I make will be sealed to the one before it.",
    tail: "Nothing I do will be missing from the chain.",
    anchor: "chain ready · 0 decisions",
    hash: "—",
  },
  evidence: {
    head: "I'll write every decision down the moment I make it.",
    tail: "Each one will be sealed to the one before. Nothing can be removed without a mark.",
    anchor: "chain intact · 0 records",
    hash: "—",
  },
  learning: {
    head: "When I notice a pattern worth turning into a rule, I will bring it to you.",
    tail: "I will not act on it until you say yes.",
    anchor: "0 proposals · waiting on signal",
    hash: "—",
  },
};
