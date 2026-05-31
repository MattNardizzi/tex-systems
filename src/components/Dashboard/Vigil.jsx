import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./Vigil.css";
import { useVigil } from "../../hooks/useVigil";
import { useSystemState } from "../../hooks/useSystemState";
import { askTex } from "../../lib/texApi";
import { TexListener, texSpeak, stopSpeaking } from "../../lib/texVoiceClient";

/* ==================================================================
   Vigil — the entire product surface.

   One screen. One mark. One voice.

   The surface is a single letter T that breathes. The breath makes
   two promises at once: nothing here is yours to do, and you can
   trust the silence — everything is sealed and provable. There are
   exactly two ways those promises break, so the breath has exactly
   three states:

     REST       slow tidal swell, ink hue.
                Nothing is yours. Trust the silence.

     HELD       the inhale rises and is held at the top, suspended,
                same hue. Something is yours now — Tex froze an action
                and reserved the decision for a human (an ABSTAIN). It
                waits. It does not alarm. When you reach for Tex, Tex
                names the held thing first, then you may speak.

     FALTERING  the rhythm goes ragged and the trusted hue goes pale.
                Tex's own integrity failed — the evidence chain broke,
                an agent went dark, Tex can no longer prove what it
                claims. The only deviation Tex ever shows about itself.
                Tex speaks first, unprompted, the moment it can.

   The ask gesture never changes: press and hold the T to address Tex.
   No wake word, no hot mic — Tex listens only when held. In REST,
   holding opens the mic and Tex answers your question, grounded only
   in sealed facts. In HELD and FALTERING, Tex's voice speaks first,
   then the mic opens.

   FIRST VISIT EVER (once per browser): one sentence, then it dissolves
   and the breath begins. The sentence teaches the mark its meaning and
   never appears again.

   There is no chrome. No T in a corner — the T is never a static logo,
   only the living mark, here. No standing word, no dashboard, no scroll.
   ================================================================== */

/* The one sentence a first-time visitor ever reads. It carries the
   authority (mine to allow or stop — Tex decides, which is why it can
   be silent) and the invitation (connect your agents — the one thing
   that is the user's to do). Present tense. No proof offered before
   there is doubt, no future-boast. Read once, then gone forever. */
const FIRST_SENTENCE =
  "I'm Tex. Connect your agents — every action they take is mine to allow or stop.";

/* First-visit pacing. */
const FIRST_IN_MS = 1_400;   /* the sentence fades up */
const FIRST_HOLD_MS = 4_600; /* it rests, read once */
const FIRST_OUT_MS = 1_200;  /* it dissolves */

/* How long a spoken line lingers before the breath reclaims the screen.
   Faltering lingers longest because it matters most; a rest answer
   fades sooner because nothing is owed. */
const FALTER_LINE_MS = 11_000;
const ANSWER_LINE_MS = 8_000;

/* Server-side flag stand-in. When the backend grows a user model with a
   seen_intro_at field, this becomes a fetch. Until then the once-per-
   browser contract lives here. */
const INTRO_FLAG_KEY = "tex.seen_intro_at";

function hasSeenIntro() {
  try {
    return Boolean(window.localStorage.getItem(INTRO_FLAG_KEY));
  } catch {
    return true; /* fail closed: never replay on a broken browser */
  }
}
function markIntroSeen() {
  try {
    window.localStorage.setItem(INTRO_FLAG_KEY, new Date().toISOString());
  } catch {
    /* no-op */
  }
}

/* Per-load guard so React 18's development double-mount, a fast refresh,
   or a parent re-key cannot replay the once-only sentence. */
let introPlayedThisLoad = false;

/* ------------------------------------------------------------------ */
/* Breath derivation                                                   */
/*                                                                     */
/* The three states are not a severity scale. They are: healthy at     */
/* rest, healthy but holding one decision for you, and not healthy.    */
/* Each maps to a specific backend signal. A dev override lets the      */
/* three be reviewed without a live backend producing an abstain or a   */
/* broken chain.                                                       */
/* ------------------------------------------------------------------ */

function deriveBreath(vigil, snapshot, override) {
  if (override) return override;

  /* FALTERING — integrity failure. The chain not adding up is the one
     thing Tex cannot stand silently behind. */
  const chain = snapshot?.chain ?? {};
  const intact =
    (chain.discovery_chain_intact ?? true) &&
    (chain.snapshot_chain_intact ?? true);
  if (snapshot && !intact) return "faltering";

  /* HELD — a decision is reserved for a human (an abstain), or a
     learning proposal awaits sign-off. Both are "something is yours,
     and it can wait." */
  if (vigil?.human_decision) return "held";
  const proposals = snapshot?.learning_proposals;
  if (
    Array.isArray(proposals) &&
    proposals.some((p) => String(p.status || "").toUpperCase() === "PENDING")
  ) {
    return "held";
  }

  /* REST — healthy and silent. Also the honest default before any
     answer has arrived: Tex at rest, nothing owed. */
  return "rest";
}

/* The line Tex speaks first when reached in HELD, or unprompted in
   FALTERING. Grounded in whatever the wire carries; posture-true
   fallbacks when it carries nothing yet. */
function heldLine(vigil) {
  const d = vigil?.human_decision;
  const summary = d?.summary || d?.action || null;
  if (summary) {
    return `I froze one thing. ${summary} It's yours to decide.`;
  }
  return "I'm holding one thing for you. It's yours to decide — there's no rush.";
}
function falterLine(snapshot) {
  const chain = snapshot?.chain ?? {};
  const at = chain.broke_at || chain.last_sealed_at || null;
  if (at) {
    return `My evidence chain broke at ${at}. I can't prove what I've sealed since. Don't trust me until this is resolved.`;
  }
  return "My evidence chain broke. I can't prove what I've sealed since. Don't trust me until this is resolved.";
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Vigil() {
  const vigil = useVigil();
  const snapshot = useSystemState();

  /* phase: "first" (the one-time sentence) | "vigil" (the breath). */
  const [phase, setPhase] = useState(() =>
    hasSeenIntro() || introPlayedThisLoad ? "vigil" : "first"
  );
  const [firstLeaving, setFirstLeaving] = useState(false);

  /* Dev override for the three states, toggled from the dev panel. */
  const [override, setOverride] = useState(null); /* null | rest | held | faltering */

  const breath = deriveBreath(vigil, snapshot, override);

  /* Interaction state. */
  const [holding, setHolding] = useState(false); /* mic open (addressing Tex) */
  const [thinking, setThinking] = useState(false); /* released, awaiting answer */
  const [spoken, setSpoken] = useState(null); /* the line Tex is currently saying */

  const lineTimer = useRef(null);
  const clearLineTimer = () => {
    if (lineTimer.current) clearTimeout(lineTimer.current);
    lineTimer.current = null;
  };

  /* ---------------- First-visit sentence ---------------- */
  useEffect(() => {
    if (phase !== "first") return;
    if (introPlayedThisLoad) {
      setPhase("vigil");
      return;
    }
    introPlayedThisLoad = true;

    const dissolveAt = FIRST_IN_MS + FIRST_HOLD_MS;
    const t1 = setTimeout(() => setFirstLeaving(true), dissolveAt);
    const t2 = setTimeout(() => {
      markIntroSeen();
      setPhase("vigil");
    }, dissolveAt + FIRST_OUT_MS);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase]);

  /* ---------------- Faltering speaks first, unprompted ----------------
     The moment Tex enters the faltering state it says so on its own,
     without being asked. Silence while broken would be a lie told in
     the most dangerous window. */
  useEffect(() => {
    if (phase !== "vigil") return;
    if (breath !== "faltering") return;
    clearLineTimer();
    setSpoken({ kind: "falter", text: falterLine(snapshot) });
    lineTimer.current = setTimeout(() => setSpoken(null), FALTER_LINE_MS);
    return clearLineTimer;
    /* Re-run only when we ENTER faltering, not on every snapshot poll. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, breath]);

  /* Leaving faltering or held clears any lingering line. */
  useEffect(() => {
    if (breath === "rest") {
      /* don't stomp a fresh answer the user just got */
      if (spoken && spoken.kind !== "answer") setSpoken(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breath]);

  /* ---------------- The ask gesture: press and hold ---------------- */

  const listenerRef = useRef(null);

  const beginHold = useCallback(() => {
    if (phase !== "vigil") return;
    clearLineTimer();
    stopSpeaking();
    setThinking(false);
    setHolding(true);

    /* In held and faltering, Tex's voice speaks FIRST — before the mic
       opens — so you hear what Tex is holding or what failed before you
       say anything. Same single voice, streamed from the gateway. In
       rest, nothing is owed: the mic just opens. */
    if (breath === "held") {
      const text = heldLine(vigil);
      setSpoken({ kind: "held", text });
      texSpeak(text);
    } else if (breath === "faltering") {
      const text = falterLine(snapshot);
      setSpoken({ kind: "falter", text });
      texSpeak(text);
    }

    /* Open the mic — only while held. Streams 16 kHz PCM to Tex's own
       gateway. Any failure (denied, unsupported, unreachable) leaves
       the listener null and the loop stays silent. */
    const listener = new TexListener();
    listenerRef.current = listener;
    listener.start().catch(() => {
      listenerRef.current = null;
    });
  }, [phase, breath, vigil, snapshot]);

  const endHold = useCallback(() => {
    if (!holding) return;
    setHolding(false);

    const listener = listenerRef.current;
    listenerRef.current = null;
    if (!listener) {
      /* No mic was ever live (denied/unsupported/unreachable). Tex does
         not announce a plumbing problem — it stays quiet. */
      return;
    }

    /* Release = you've finished addressing Tex. Finalize the transcript,
       answer grounded only in sealed facts, then speak it in Tex's one
       voice. If nothing was heard or the wire is down, stay quiet. */
    setThinking(true);
    listener
      .stop()
      .then((transcript) => {
        if (!transcript) {
          setThinking(false);
          return undefined;
        }
        return askTex(transcript).then((res) => {
          const text = res?.answer || null;
          setThinking(false);
          if (text) {
            setSpoken({ kind: "answer", text });
            texSpeak(text);
            clearLineTimer();
            lineTimer.current = setTimeout(() => setSpoken(null), ANSWER_LINE_MS);
          }
        });
      })
      .catch(() => setThinking(false));
  }, [holding]);

  /* Keyboard parity: space/enter holds while pressed. */
  const onKeyDown = (e) => {
    if (e.repeat) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      beginHold();
    }
  };
  const onKeyUp = (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      endHold();
    }
  };

  /* ---------------- Dev panel (⌘. / Ctrl+.) ----------------
     Scaffolding only. Lets the three breath states and the speak-back
     surface be reviewed without a live backend. Remove before ship. */
  const [devOpen, setDevOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setDevOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const devAnswer = () => {
    clearLineTimer();
    setSpoken({ kind: "answer", text: "Fourteen agents. All governed, all sealed." });
    lineTimer.current = setTimeout(() => setSpoken(null), ANSWER_LINE_MS);
  };
  const devResetIntro = () => {
    try {
      window.localStorage.removeItem(INTRO_FLAG_KEY);
    } catch {
      /* no-op */
    }
    introPlayedThisLoad = false;
    setFirstLeaving(false);
    setSpoken(null);
    setPhase("first");
  };

  /* ---------------- Render ---------------- */

  const markClass = useMemo(() => {
    const base = "tex-mark-glyph";
    const state = `tex-mark-glyph--${breath}`;
    const listening = holding ? " is-listening" : "";
    const think = thinking ? " is-thinking" : "";
    return `${base} ${state}${listening}${think}`;
  }, [breath, holding, thinking]);

  if (phase === "first") {
    return (
      <section className="tex-vigil">
        <div className="tex-stage">
          <p
            className={`tex-first-sentence${firstLeaving ? " is-leaving" : ""}`}
            style={{
              animationDuration: `${FIRST_IN_MS}ms`,
            }}
          >
            {FIRST_SENTENCE}
          </p>
        </div>
      </section>
    );
  }

  const ariaState =
    breath === "held"
      ? "Tex is holding a decision for you. Press and hold to hear it."
      : breath === "faltering"
      ? "Tex's integrity has failed. Press and hold to hear what is wrong."
      : "Tex, at rest. Press and hold to speak.";

  return (
    <section className="tex-vigil">
      <div className="tex-stage">
        <button
          type="button"
          className={markClass}
          aria-label={ariaState}
          onPointerDown={beginHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
        >
          <span aria-hidden="true">
            <svg
              className="tex-mark-svg"
              viewBox="0 0 716 736"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="10" y="10" width="696" height="16" />
              <rect x="350" y="74" width="16" height="652" />
            </svg>
          </span>
        </button>

        <div className="tex-voice" aria-live="polite">
          {spoken && (
            <p
              className={`tex-voice-line tex-voice-line--${spoken.kind}`}
              key={spoken.text}
            >
              {spoken.text}
            </p>
          )}
          {!spoken && thinking && (
            <p className="tex-voice-line tex-voice-line--thinking" aria-hidden="true">
              &nbsp;
            </p>
          )}
        </div>
      </div>

      {devOpen && (
        <div className="tex-dev-panel" role="group" aria-label="Dev controls">
          <span className="tex-dev-panel-label">breath</span>
          {["rest", "held", "faltering"].map((s) => (
            <button
              key={s}
              type="button"
              className={override === s ? "is-active" : ""}
              onClick={() => setOverride(s === override ? null : s)}
            >
              {s}
            </button>
          ))}
          <span className="tex-dev-panel-sep" />
          <button type="button" onClick={devAnswer}>
            sample answer
          </button>
          <button type="button" onClick={devResetIntro}>
            replay intro
          </button>
        </div>
      )}
    </section>
  );
}
