import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./Vigil.css";
import { useVigil } from "../../hooks/useVigil";
import { useSystemState } from "../../hooks/useSystemState";
import { askTex } from "../../lib/texApi";
import { TexListener, texSpeak, stopSpeaking } from "../../lib/texVoiceClient";

/* ==================================================================
   Vigil — the entire product surface.

   There is no T. There is no logo, no mark, no breathing letter. The
   surface at rest is silence — empty paper. Tex is watching, and the
   proof that it is watching is the faintest pulse at the center: not
   a glyph, not a letter, a single breath you only notice if you look
   for it. Quiet, not dead. The pulse exists for one reason — a blank
   screen cannot prove it is alive, and a witness must never look
   crashed during the watch.

   Tex speaks ONLY when it has something for you. The screen breaks
   its silence in exactly two ways:

     HELD       a decision is reserved for a human. Tex froze an
                action it will not take on its own authority (an
                ABSTAIN) and surfaces it, in its own voice, with the
                facts that matter and the resolved acts that seal it.
                A wire transfer is not approved by a spoken "yes" —
                it is sealed by a named human act the evidence layer
                can prove. So the held state carries approve / hold /
                refuse, and resolving it writes a sealed decision.

     FALTERING  Tex's own integrity failed — the evidence chain broke,
                an agent went dark, Tex can no longer prove what it
                claims. It speaks first, unprompted, the instant it
                can. Silence while broken is a lie told in the most
                dangerous window.

   The ask gesture lives everywhere: press and hold ANYWHERE on the
   surface to address Tex. No wake word, no hot mic — Tex listens only
   while held. In silence, holding opens the mic and Tex answers,
   grounded only in sealed facts. In held and faltering, Tex's voice
   speaks first, then the mic opens.
   ================================================================== */

/* The line Tex speaks first when reached in a held state, or that the
   held card renders. Grounded in whatever the wire carries; posture-
   true fallbacks when it carries nothing yet. */
function heldSentence(decision) {
  return (
    decision?.sentence ||
    "I need to know if I can let this through. It's yours to decide."
  );
}
function heldDetail(decision) {
  return decision?.detail || null;
}
function falterLine(snapshot) {
  const chain = snapshot?.chain ?? {};
  const at = chain.broke_at || chain.last_sealed_at || null;
  if (at) {
    return `My evidence chain broke at ${at}. I can't prove what I've sealed since. Don't trust me until this is resolved.`;
  }
  return "My evidence chain broke. I can't prove what I've sealed since. Don't trust me until this is resolved.";
}

/* How long a spoken answer lingers before silence reclaims the screen. */
const ANSWER_LINE_MS = 8_000;

/* Demo: the abstain that surfaces on its own so the held state can be
   seen without a live backend. This is what a real /v1/vigil
   human_decision would carry. Remove the demo wiring before ship; the
   shape is the contract. */
const DEMO_ABSTAIN = {
  id: "dec_9f3a71c2",
  sentence: "I need to know if I can send this wire transfer.",
  detail:
    "$48,000 to an account I'm seeing for the first time today. The payments agent asked to send it four seconds ago. I froze it.",
  /* The sealed facts the proof rests on. */
  anchor_sha256: "b7e23ec29af22b0b4e0d8f6c1a93d5f8c2e1a04d9b3f7c6e",
  agent: "payments-agent-03",
  /* When this demo fires after the surface goes quiet (ms). */
  fires_after_ms: 3_400,
};

/* ------------------------------------------------------------------ */
/* Breath / state derivation                                           */
/* ------------------------------------------------------------------ */

function deriveState(vigil, snapshot, demoDecision, override) {
  if (override) return override;

  const chain = snapshot?.chain ?? {};
  const intact =
    (chain.discovery_chain_intact ?? true) &&
    (chain.snapshot_chain_intact ?? true);
  if (snapshot && !intact) return "faltering";

  if (vigil?.human_decision || demoDecision) return "held";

  return "silent";
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Vigil() {
  const vigil = useVigil();
  const snapshot = useSystemState();

  /* The demo abstain — fires itself once after the surface settles,
     so the held state is visible without a live backend. A real build
     gets this from vigil.human_decision and never sets it here. */
  const [demoDecision, setDemoDecision] = useState(null);
  const demoFiredRef = useRef(false);

  /* Dev override for the states, toggled from the dev panel. */
  const [override, setOverride] = useState(null); /* null | silent | held | faltering */

  /* The resolved act, briefly shown as a seal before returning to
     silence. { verdict: "approved"|"held"|"refused", at, anchor } */
  const [sealed, setSealed] = useState(null);

  const liveDecision = vigil?.human_decision || demoDecision || null;
  const state = deriveState(vigil, snapshot, demoDecision, override);

  /* Interaction state. */
  const [holding, setHolding] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [spoken, setSpoken] = useState(null);

  const lineTimer = useRef(null);
  const clearLineTimer = () => {
    if (lineTimer.current) clearTimeout(lineTimer.current);
    lineTimer.current = null;
  };

  /* ---------------- Demo abstain fires itself ---------------- */
  useEffect(() => {
    if (demoFiredRef.current) return;
    if (override) return; /* dev override owns the state */
    demoFiredRef.current = true;
    const t = setTimeout(() => {
      setDemoDecision(DEMO_ABSTAIN);
    }, DEMO_ABSTAIN.fires_after_ms);
    return () => clearTimeout(t);
  }, [override]);

  /* ---------------- Faltering speaks first, unprompted ---------------- */
  useEffect(() => {
    if (state !== "faltering") return;
    clearLineTimer();
    setSpoken({ kind: "falter", text: falterLine(snapshot) });
    return clearLineTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /* ---------------- The ask gesture: press and hold anywhere ---------------- */
  const listenerRef = useRef(null);

  const beginHold = useCallback(
    (e) => {
      /* Don't start a hold when pressing an actual decision button. */
      if (e && e.target && e.target.closest && e.target.closest("[data-act]")) {
        return;
      }
      clearLineTimer();
      stopSpeaking();
      setThinking(false);
      setHolding(true);

      if (state === "held") {
        const text = heldSentence(liveDecision);
        setSpoken({ kind: "held", text });
        texSpeak(text);
      } else if (state === "faltering") {
        const text = falterLine(snapshot);
        setSpoken({ kind: "falter", text });
        texSpeak(text);
      }

      const listener = new TexListener();
      listenerRef.current = listener;
      listener.start().catch(() => {
        listenerRef.current = null;
      });
    },
    [state, liveDecision, snapshot]
  );

  const endHold = useCallback(() => {
    if (!holding) return;
    setHolding(false);

    const listener = listenerRef.current;
    listenerRef.current = null;
    if (!listener) return;

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

  /* ---------------- Resolving a held decision ----------------
     A wire transfer is sealed by a named human act, not a spoken
     maybe. Approve / hold / refuse each write a sealed decision the
     evidence layer can prove. Here it shows the seal briefly, then the
     surface returns to silence. A real build POSTs the verdict and the
     backend writes the ledger entry the hash signs. */
  const resolve = useCallback(
    (verdict) => {
      const decision = liveDecision;
      stopSpeaking();
      setSpoken(null);
      setSealed({
        verdict,
        at: new Date(),
        anchor: decision?.anchor_sha256 || null,
      });
      /* Clear the decision so the state falls back to silent under the seal. */
      setDemoDecision(null);
      setOverride(null);
      /* The seal lingers, then silence reclaims the screen. */
      clearLineTimer();
      lineTimer.current = setTimeout(() => setSealed(null), 4_200);
    },
    [liveDecision]
  );

  /* ---------------- Dev panel (⌘. / Ctrl+.) ---------------- */
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

  const devReplayAbstain = () => {
    setSealed(null);
    setOverride(null);
    setSpoken(null);
    setDemoDecision(DEMO_ABSTAIN);
  };
  const devSilence = () => {
    setSealed(null);
    setOverride(null);
    setSpoken(null);
    setDemoDecision(null);
  };

  /* ---------------- Render ---------------- */

  const fieldClass = useMemo(() => {
    const base = "tex-field";
    const s = `tex-field--${state}`;
    const listening = holding ? " is-listening" : "";
    const think = thinking ? " is-thinking" : "";
    return `${base} ${s}${listening}${think}`;
  }, [state, holding, thinking]);

  const ariaState =
    state === "held"
      ? "Tex is holding a decision for you."
      : state === "faltering"
      ? "Tex's integrity has failed."
      : "Tex, watching. Press and hold anywhere to speak.";

  const decision = liveDecision;

  return (
    <section
      className={fieldClass}
      aria-label={ariaState}
      tabIndex={0}
      onPointerDown={beginHold}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      {/* The pulse — proof of life. Visible only at rest; the faintest
          sign Tex is awake. Not a mark, not a letter. Quiet, not dead. */}
      {state === "silent" && !sealed && (
        <span className="tex-pulse" aria-hidden="true" />
      )}

      {/* The seal — a resolved decision, shown briefly before silence. */}
      {sealed && (
        <div className="tex-seal" role="status">
          <p className="tex-seal-line">
            {sealed.verdict === "approved"
              ? "Sealed. You approved it."
              : sealed.verdict === "refused"
              ? "Sealed. You refused it."
              : "Held. It waits for you."}
          </p>
          {sealed.anchor && (
            <p className="tex-seal-hash">
              {sealed.anchor.slice(0, 16)}…&nbsp;·&nbsp;
              {sealed.at.toLocaleTimeString()}
            </p>
          )}
        </div>
      )}

      {/* The held decision — Tex's voice, the facts, the resolved acts. */}
      {state === "held" && decision && !sealed && (
        <div className="tex-held">
          <p className="tex-held-sentence">{heldSentence(decision)}</p>
          {heldDetail(decision) && (
            <p className="tex-held-detail">{heldDetail(decision)}</p>
          )}
          <div className="tex-acts">
            <button
              type="button"
              data-act="approve"
              className="tex-act tex-act--approve"
              onClick={() => resolve("approved")}
            >
              Approve
            </button>
            <button
              type="button"
              data-act="hold"
              className="tex-act tex-act--hold"
              onClick={() => resolve("held")}
            >
              Keep holding
            </button>
            <button
              type="button"
              data-act="refuse"
              className="tex-act tex-act--refuse"
              onClick={() => resolve("refused")}
            >
              Refuse
            </button>
          </div>
          <p className="tex-held-ask" aria-hidden="true">
            press and hold anywhere to ask Tex about it
          </p>
        </div>
      )}

      {/* The voice — answers and faltering lines, when not in a held card. */}
      {state !== "held" && !sealed && (
        <div className="tex-voice" aria-live="polite">
          {spoken && (
            <p
              className={`tex-voice-line tex-voice-line--${spoken.kind}`}
              key={spoken.text}
            >
              {spoken.text}
            </p>
          )}
        </div>
      )}

      {devOpen && (
        <div
          className="tex-dev-panel"
          role="group"
          aria-label="Dev controls"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="tex-dev-panel-label">demo</span>
          <button type="button" onClick={devReplayAbstain}>
            replay abstain
          </button>
          <button type="button" onClick={devSilence}>
            silence
          </button>
          <span className="tex-dev-panel-sep" />
          <button
            type="button"
            className={override === "faltering" ? "is-active" : ""}
            onClick={() =>
              setOverride(override === "faltering" ? null : "faltering")
            }
          >
            faltering
          </button>
        </div>
      )}
    </section>
  );
}
