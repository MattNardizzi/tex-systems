import { useEffect, useMemo, useRef, useState } from "react";
import "./Vigil.css";
import { useSystemState } from "../../hooks/useSystemState";
import { useVigil } from "../../hooks/useVigil";
import { explainLine } from "../../lib/texApi";
import { speak, ALL_LAYERS } from "../../lib/texVoice";

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
     The sentences Tex chose cycle, one at a time, in the same
     place, in the same size. Each holds 7.4s, then crossfades.
     The sentences and the standing word come from GET /v1/vigil —
     Tex decides what to say on the backend (Bayesian surprise
     across the six dimensions, sealed-filled forms); the frontend
     renders the choice and computes nothing about it. The vigil
     does not end.

   PHASE: proof
     Click a sentence. The summary dissolves. Tex finishes the
     story of that one thing in the same voice — POST /v1/vigil/explain
     returns prose grounded in the sealed facts for that dimension.
     Below it, a small italic anchor in Tex's voice. Hover the
     anchor — the SHA-256 hash appears in monospace, the only place
     in the product where typography breaks register. After a beat
     of stillness, Tex returns to the vigil at the next sentence.

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
  /* The live voice. Tex chooses what to say on the backend; this is the
     choice. Null until the first fetch resolves — the render falls back
     to a posture-forward ready line while null, never a blank stage. */
  const vigil = useVigil();

  /* System state still feeds the day-two threshold door (the overnight
     catch-up), which has no dedicated backend endpoint yet. The live
     vigil no longer derives from this. */
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
  /* The explanation Tex returns when a line is opened. Null until the
     explain call resolves; the proof layer shows a posture-forward
     fallback while null or if the call fails. */
  const [proof, setProof] = useState(null);

  const advanceTimer = useRef(null);
  const fadeTimer = useRef(null);
  const proofReturnTimer = useRef(null);
  const blackoutTimer = useRef(null);

  /* ---------------- The chosen voice ----------------

     The vigil renders whatever Tex chose this cycle, in surprise order.
     The frontend authors and ranks nothing. When the backend hasn't
     answered yet, or returned nothing, one posture-forward line keeps
     the stage speaking instead of blank. Declared here, above the pacing
     effects, because the rotation cycles over its length. */
  const READY_FALLBACK = {
    text: "I'm posted. The moment your agents appear, I'll have them.",
    dimension: "discovery",
    proof_ref: null,
    requires_human: false,
  };

  const utterances = useMemo(() => {
    const list = vigil?.utterances ?? [];
    return list.length > 0 ? list : [READY_FALLBACK];
  }, [vigil]);

  /* ---------------- The witness at rest ----------------

     When Tex has nothing true to report — no agents yet, or the vigil
     hasn't answered this session — there is nothing to say, so Tex says
     nothing. The screen is one breathing letter and nothing else. A
     witness at rest does not narrate its own waiting; patience does not
     announce itself. The instant a real utterance arrives, this goes
     false and Tex speaks. The signal is read straight off the wire:
     an empty (or not-yet-loaded) utterance list. */
  const nothingToReport = !vigil || (vigil.utterances?.length ?? 0) === 0;

  /* ---------------- Chrome visibility ----------------

     The chrome (T mark + avatar) is hidden during the manifesto and
     during the blackout. It first appears at the moment the vigil
     begins on day one, and is always visible from then on — EXCEPT
     when Tex is at rest. With nothing to report, the screen is one
     breathing T and nothing else; a second T in the corner and an
     avatar would contradict that stillness. The chrome returns the
     instant Tex speaks, because then navigating and looking closer
     become meaningful again. The threshold door keeps its chrome from
     the first frame (the rest-gate only applies inside the vigil). */
  useEffect(() => {
    if (!onChromeReady) return;
    const showChrome =
      phase !== "manifesto" &&
      !blackout &&
      !(phase === "vigil" && nothingToReport);
    onChromeReady(showChrome);
  }, [phase, blackout, nothingToReport, onChromeReady]);

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
        setIndex((i) => (i + 1) % Math.max(utterances.length, 1));
        setLeaving(false);
      }, CROSSFADE_MS);
    }, VIGIL_HOLD_MS);

    return clearAll;
  }, [phase, index, paused, utterances.length]);

  /* Proof → vigil. */
  useEffect(() => {
    if (phase !== "proof") return;
    if (paused) return;

    proofReturnTimer.current = setTimeout(() => {
      setLeaving(true);
      fadeTimer.current = setTimeout(() => {
        setPhase("vigil");
        setIndex((i) => (i + 1) % Math.max(utterances.length, 1));
        setLeaving(false);
        setHashVisible(false);
        setProof(null);
      }, CROSSFADE_MS);
    }, PROOF_RETURN_MS);

    return clearAll;
  }, [phase, paused, utterances.length]);

  /* ---------------- Voice derivation ----------------

     utterances (the chosen voice) is derived above, where the rotation
     can read it. Here we resolve the standing word, the threshold-door
     sentences, and the current line. */

  /* The standing word is Tex's posture, owned by the backend: "Absolute"
     when nothing is unresolved, "Open" the moment it cannot stand fully
     behind the calm. Default to Absolute before the first response. */
  const standingWord = vigil?.standing ?? "Absolute";

  const thresholdSentences = useMemo(() => {
    const all = speak(snapshot ?? null, ALL_LAYERS);
    const byKey = Object.fromEntries(all.map((x) => [x.key, x]));
    return [byKey.discovery, byKey.monitoring, byKey.execution];
  }, [snapshot]);

  /* Index can outrun a freshly-shrunk utterance list between polls. */
  const safeIndex = utterances.length ? index % utterances.length : 0;
  const current = utterances[safeIndex] ?? utterances[0];
  const proofFallback =
    PROOF_PLACEHOLDERS[current?.dimension] ?? PROOF_PLACEHOLDERS.evidence;

  /* The proof view-model. When Tex has returned an explanation for the
     opened line, the prose and the sealed anchor are real; the hash is
     the sha256 of the first sealed anchor (or the line's own proof_ref).
     Until then — or if the explain call fails — the posture-forward
     fallback keeps the layer's shape intact, never a blank or a spinner. */
  const proofAnchorSha =
    proof?.facts?.anchors?.find((a) => a.sha256)?.sha256 ??
    current?.proof_ref?.sha256 ??
    null;
  const proofView = proof
    ? {
        prose: proof.explanation,
        anchorLabel: proof.facts?.headline || "sealed",
        hash: proofAnchorSha || "—",
      }
    : {
        prose: null, // render the fallback head/tail pair below
        anchorLabel: proofFallback.anchor,
        hash: proofAnchorSha || proofFallback.hash,
      };

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

    /* Ask Tex to finish the story behind this exact line. Fire now so the
       prose is likely ready by the time the proof stage renders. The line
       being opened is the claim; the dimension routes the sealed facts. */
    const line = current;
    setProof(null);
    if (line?.dimension) {
      explainLine(line.dimension, line.text)
        .then((res) => setProof(res))
        .catch(() => setProof(null)); // fall back to the posture line
    }

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

      {phase === "vigil" && nothingToReport && (
        <div className="tex-vigil-stage tex-vigil-stage--idle" key="vigil-rest">
          <div className="tex-vigil-rest" aria-label="Tex, at rest. Nothing to report.">
            <span className="tex-vigil-rest-mark" aria-hidden="true">T</span>
          </div>
        </div>
      )}

      {phase === "vigil" && !nothingToReport && current && (
        <div className={stageClass()} key={`vigil-${index}`}>
          <div className="tex-vigil-stack">
            <h1
              className={`tex-vigil-word tex-vigil-word--${standingWord.toLowerCase()}`}
              aria-label={`${standingWord}.`}
            >
              <svg
                className="tex-vigil-glass"
                viewBox="0 0 900 240"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="tex-vigil-glass-body" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%"   stopColor="#F4F6FA" stopOpacity="0.98" />
                    <stop offset="28%"  stopColor="#C8D2DE" stopOpacity="0.92" />
                    <stop offset="58%"  stopColor="#5B6E84" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="#1D2733" stopOpacity="1"    />
                  </linearGradient>

                  <linearGradient id="tex-vigil-glass-rim" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%"  stopColor="#FFFFFF" stopOpacity="0.85" />
                    <stop offset="14%" stopColor="#FFFFFF" stopOpacity="0"    />
                    <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0"   />
                  </linearGradient>

                  <radialGradient id="tex-vigil-word-floor" cx="50%" cy="50%" r="50%">
                    <stop offset="0%"   stopColor="#0E1620" stopOpacity="0.10" />
                    <stop offset="60%"  stopColor="#0E1620" stopOpacity="0.04" />
                    <stop offset="100%" stopColor="#0E1620" stopOpacity="0"    />
                  </radialGradient>

                  <mask id="tex-vigil-glass-mask">
                    <text
                      x="450" y="178"
                      textAnchor="middle"
                      fontFamily="var(--tex-serif)"
                      fontSize="186"
                      fontWeight="400"
                      letterSpacing="-11"
                      fill="#FFFFFF"
                    >{standingWord}.</text>
                  </mask>
                </defs>

                <ellipse cx="450" cy="210" rx="320" ry="14" fill="url(#tex-vigil-word-floor)" />

                <text
                  x="450" y="178"
                  textAnchor="middle"
                  fontFamily="var(--tex-serif)"
                  fontSize="186"
                  fontWeight="400"
                  letterSpacing="-11"
                  fill="url(#tex-vigil-glass-body)"
                >{standingWord}.</text>

                <text
                  x="450" y="178"
                  textAnchor="middle"
                  fontFamily="var(--tex-serif)"
                  fontSize="186"
                  fontWeight="400"
                  letterSpacing="-11"
                  fill="url(#tex-vigil-glass-rim)"
                >{standingWord}.</text>

                <text
                  x="450" y="178"
                  textAnchor="middle"
                  fontFamily="var(--tex-serif)"
                  fontSize="186"
                  fontWeight="400"
                  letterSpacing="-11"
                  fill="none"
                  stroke="#5B6E84"
                  strokeOpacity="0.32"
                  strokeWidth="0.6"
                >{standingWord}.</text>

                <g mask="url(#tex-vigil-glass-mask)">
                  <rect
                    className="tex-vigil-glass-sweep"
                    x="-200" y="0"
                    width="280" height="240"
                    fill="#E6F0FF"
                    opacity="0.85"
                  />
                </g>
              </svg>
            </h1>

            <button
              type="button"
              className="tex-vigil-sentence tex-vigil-sentence--under"
              onClick={handleSentenceClick}
              aria-label="Look closer at this"
            >
              <em className="tex-vigil-undertext">
                <span className="tex-vigil-head">{current.text}</span>
              </em>
            </button>
          </div>
        </div>
      )}

      {phase === "proof" && current && (
        <div className={stageClass()} key={`proof-${index}`}>
          <div className="tex-vigil-proof">
            <p className="tex-vigil-proof-line">
              {proofView.prose ? (
                /* Tex finished the story — grounded in sealed facts. */
                <span className="tex-vigil-head">{proofView.prose}</span>
              ) : (
                /* No explanation yet (or the call failed): posture prose. */
                <>
                  <span className="tex-vigil-head">{proofFallback.head}</span>{" "}
                  <em className="tex-vigil-tail">{proofFallback.tail}</em>
                </>
              )}
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
              {proofView.anchorLabel}
            </button>

            <p
              className={`tex-vigil-hash${hashVisible ? " is-visible" : ""}`}
              aria-hidden={!hashVisible}
            >
              {proofView.hash}
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
