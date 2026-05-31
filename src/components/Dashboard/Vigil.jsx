import { useEffect, useMemo, useRef, useState } from "react";
import "./Vigil.css";
import { useSystemState } from "../../hooks/useSystemState";
import { useVigil } from "../../hooks/useVigil";
import { explainLine } from "../../lib/texApi";
import { speak, ALL_LAYERS } from "../../lib/texVoice";

/* ==================================================================
   Vigil — the entire product surface.

   One screen. One voice. Three depths.

   PHASE: intro (the first time this person ever opens tex.systems)
     Three sentences arrive one at a time, slowly, on white. No chrome
     — no T mark, no avatar. Tex stating its posture before it has a
     night to report. This happens once per browser, ever. The
     server-side flag (localStorage for now) records that it happened.
     After the first visit, this screen never shows again.

   OPENING (every visit):
     The page opens on a single black T in Cormorant Garamond. It
     arrives faded — light black — and deepens to full black over
     2.5 seconds. No chrome. The deepen is the inhale. The instant it
     reaches full ink, Tex speaks: the T gives way to the vigil. This
     is not a summon. No click, no hover. Tex speaks because it has
     something to say and you are here.

   PHASE: vigil
     The sentences Tex chose cycle, one at a time, in the same place,
     in the same size. Each holds 7.4s, then crossfades. The sentences
     and the standing word come from GET /v1/vigil — Tex decides what
     to say on the backend; the frontend renders the choice and
     computes nothing about it. The vigil does not end.

   PHASE: proof
     Click a sentence. The summary dissolves. Tex finishes the story
     of that one thing in the same voice — POST /v1/vigil/explain
     returns prose grounded in the sealed facts for that dimension.
     Below it, a small italic anchor. Hover the anchor — the SHA-256
     hash appears in monospace, the only place the type breaks
     register. After a beat, Tex returns to the vigil.

   The T mark resets to the vigil, never replays the intro or the
   opening. Hovering anywhere pauses pacing. There are no other
   controls.
   ================================================================== */

/* Pacing constants — all in one place so the rhythm is easy to tune. */

/* Intro pacing — once per browser, ever. Three sentences. */
const INTRO_FIRST_DELAY_MS = 400;
const INTRO_LINE_STAGGER_MS = 2_600;
const INTRO_LINE_FADE_MS = 1_000;
const INTRO_HOLD_MS = 2_400;
const INTRO_PAUSE_MS = 1_400;

/* Opening pacing — the black T deepening from faded to full ink, then
   Tex speaks. This is the inhale before the first sentence, every load. */
const OPEN_INK_MS = 2_500;

/* Vigil pacing — the steady rhythm Tex lives in. */
const VIGIL_HOLD_MS = 7_400;
const CROSSFADE_MS = 700;

/* Proof pacing. */
const PROOF_RETURN_MS = 14_000;

/* Server-side flag stand-in. When the backend grows a user model with
   a seen_intro_at field, this becomes a fetch. Until then we keep the
   once-per-browser contract locally. */
const INTRO_FLAG_KEY = "tex.seen_intro_at";

function hasSeenIntro() {
  try {
    return Boolean(window.localStorage.getItem(INTRO_FLAG_KEY));
  } catch {
    /* If localStorage is unavailable, fail closed — skip the intro.
       It exists to be seen at most once; never showing it again on a
       broken browser is the safer side of the contract. */
    return true;
  }
}

function markIntroSeen() {
  try {
    window.localStorage.setItem(INTRO_FLAG_KEY, new Date().toISOString());
  } catch {
    /* No-op. The next session will simply skip the intro too. */
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

  /* System state feeds the once-only intro door (the three posture
     sentences). The live vigil no longer derives from this. */
  const snapshot = useSystemState();

  /* Initial phase: the intro the first time ever, the vigil otherwise. */
  const [phase, setPhase] = useState(() =>
    hasSeenIntro() ? "vigil" : "intro"
  );

  /* The opening deepen plays once, on the first entry into the vigil
     this load. Pressing the T or returning from proof never replays it. */
  const [opening, setOpening] = useState(true);
  const openedRef = useRef(false);

  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [hashVisible, setHashVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  /* The explanation Tex returns when a line is opened. */
  const [proof, setProof] = useState(null);

  const advanceTimer = useRef(null);
  const fadeTimer = useRef(null);
  const proofReturnTimer = useRef(null);
  const openTimer = useRef(null);

  /* ---------------- The chosen voice ----------------

     The vigil renders whatever Tex chose this cycle, in surprise order.
     The frontend authors and ranks nothing. When the backend hasn't
     answered yet, one posture-forward line keeps the stage speaking
     instead of blank — Tex without a response yet is still Tex. */
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

     True silence is a state Tex has EARNED, not a state of not having
     answered. Tex is at rest only when the wire HAS answered this
     session and chose to say nothing (warm and empty). A wire that
     hasn't answered yet is not silence — Tex speaks the posted line.
     This is the difference between "nothing to report" and "no report
     yet," and it is what lets the opening hand off to speech. */
  const nothingToReport =
    !!vigil && (vigil.utterances?.length ?? 0) === 0;

  /* ---------------- Chrome visibility ----------------

     The chrome (T mark + avatar) is hidden during the intro and during
     the opening deepen — nothing exists on the page but the letter. It
     appears the moment Tex speaks, because then navigating and looking
     closer become meaningful. It hides again only in earned rest. */
  useEffect(() => {
    if (!onChromeReady) return;
    const showChrome =
      phase !== "intro" && !opening && !nothingToReport;
    onChromeReady(showChrome);
  }, [phase, opening, nothingToReport, onChromeReady]);

  /* ---------------- T mark home ----------------

     T mark resets to the vigil. It never replays the intro or the
     opening deepen — those are unrepeatable, by design. */
  useEffect(() => {
    if (!onHomeRequested) return;
    onHomeRequested(() => {
      clearAll();
      if (!hasSeenIntro()) markIntroSeen();
      setOpening(false);
      openedRef.current = true;
      setPhase("vigil");
      setIndex(0);
      setLeaving(false);
      setHashVisible(false);
    });
  }, [onHomeRequested]);

  /* ---------------- Pacing ---------------- */

  const clearAll = () => {
    [advanceTimer, fadeTimer, proofReturnTimer, openTimer].forEach((r) => {
      if (r.current) clearTimeout(r.current);
      r.current = null;
    });
  };

  /* Intro → held pause → vigil. Plays to completion regardless of hover
     — it is a delivered statement, once, and you don't interrupt it. */
  useEffect(() => {
    if (phase !== "intro") return;

    const arriveTotal =
      INTRO_FIRST_DELAY_MS +
      2 * INTRO_LINE_STAGGER_MS +
      INTRO_LINE_FADE_MS;
    const dissolveAt = arriveTotal + INTRO_HOLD_MS;

    advanceTimer.current = setTimeout(() => {
      setLeaving(true);
      fadeTimer.current = setTimeout(() => {
        markIntroSeen();
        setLeaving(false);
        proofReturnTimer.current = setTimeout(() => {
          setPhase("vigil");
          setIndex(0);
        }, INTRO_PAUSE_MS);
      }, CROSSFADE_MS);
    }, dissolveAt);

    return clearAll;
  }, [phase]);

  /* Opening deepen → speech. The first time the vigil is entered this
     load, the black T deepens from faded to full ink over 2.5s, then
     Tex speaks. Runs exactly once; the ref guards against re-entry. */
  useEffect(() => {
    if (phase !== "vigil") return;
    if (openedRef.current) return;
    openedRef.current = true;

    openTimer.current = setTimeout(() => {
      setOpening(false);
    }, OPEN_INK_MS);

    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    };
  }, [phase]);

  /* Vigil pacing. */
  useEffect(() => {
    if (phase !== "vigil") return;
    if (opening) return;
    if (paused) return;

    advanceTimer.current = setTimeout(() => {
      setLeaving(true);
      fadeTimer.current = setTimeout(() => {
        setIndex((i) => (i + 1) % Math.max(utterances.length, 1));
        setLeaving(false);
      }, CROSSFADE_MS);
    }, VIGIL_HOLD_MS);

    return clearAll;
  }, [phase, index, opening, paused, utterances.length]);

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

  /* ---------------- Voice derivation ---------------- */

  /* The standing word is Tex's posture, owned by the backend. */
  const standingWord = vigil?.standing ?? "Absolute";

  const introSentences = useMemo(() => {
    const all = speak(snapshot ?? null, ALL_LAYERS);
    const byKey = Object.fromEntries(all.map((x) => [x.key, x]));
    return [byKey.discovery, byKey.monitoring, byKey.execution];
  }, [snapshot]);

  /* Index can outrun a freshly-shrunk utterance list between polls. */
  const safeIndex = utterances.length ? index % utterances.length : 0;
  const current = utterances[safeIndex] ?? utterances[0];
  const proofFallback =
    PROOF_PLACEHOLDERS[current?.dimension] ?? PROOF_PLACEHOLDERS.evidence;

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
        prose: null,
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
    if (opening) return;
    if (leaving) return;
    clearAll();

    const line = current;
    setProof(null);
    if (line?.dimension) {
      explainLine(line.dimension, line.text)
        .then((res) => setProof(res))
        .catch(() => setProof(null));
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

  /* The opening deepen owns the screen until the ink reaches full black,
     for every visit. It renders over the vigil phase before the first
     sentence. */
  const showOpening = phase === "vigil" && opening;

  return (
    <section
      className="tex-vigil"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {phase === "intro" && (
        <div className={stageClass()} key="intro">
          <div className="tex-vigil-door tex-vigil-door--threshold">
            {introSentences.map((s, i) => {
              const delaySec =
                (INTRO_FIRST_DELAY_MS + i * INTRO_LINE_STAGGER_MS) / 1000;
              const durationSec = INTRO_LINE_FADE_MS / 1000;
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

      {showOpening && (
        <div className="tex-vigil-stage tex-vigil-stage--open" key="open">
          <div className="tex-vigil-open">
            <span className="tex-vigil-open-mark" aria-hidden="true">
              T
            </span>
          </div>
        </div>
      )}

      {phase === "vigil" && !opening && nothingToReport && (
        <div className="tex-vigil-stage tex-vigil-stage--idle" key="vigil-rest">
          <div
            className="tex-vigil-rest"
            aria-label="Tex, at rest. Nothing to report."
          >
            <span className="tex-vigil-rest-mark" aria-hidden="true">
              T
            </span>
          </div>
        </div>
      )}

      {phase === "vigil" && !opening && !nothingToReport && current && (
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
                <span className="tex-vigil-head">{proofView.prose}</span>
              ) : (
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
   proof layer fetches real decisions by id. */
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
