import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./Vigil.css";
import { useVigil } from "../../hooks/useVigil";
import { useSystemState } from "../../hooks/useSystemState";
import { useHeartbeat } from "../../hooks/useHeartbeat";
import { askTex } from "../../lib/texApi";
import { TexListener, texSpeak, stopSpeaking } from "../../lib/texVoiceClient";

/* ==================================================================
   Vigil — the entire product surface.

   There is no T. There is no logo, no mark, no breathing letter, and
   no pilot light. The surface at rest is silence — empty paper, fully
   empty. There is nothing at center but white.

   What Tex is: a witness WITH authority. It does not only watch. The
   execution governance layer rules on every action an agent attempts —
   PERMIT, FORBID, ABSTAIN — thousands of times, in the background.
   Letting a wire through is a decision. Blocking it is a decision Tex
   makes on its own authority. Holding it is Tex deciding it will not
   rule alone. Tex watches, RULES, and proves. The voice flexes to
   match: it speaks as GOVERNOR when it reports its rulings or holds one
   for you, and as WITNESS when it must confess its proof has broken.

   Tex does not announce that it is alive. A sovereign doesn't post a
   sign of life; you know it is alive two ways — the kingdom is in order,
   and when you reach for it, it answers. Tex speaks ONLY when it has
   something for you. The absence of speech is not absence of life. It
   is the calm of a watch that doesn't need you yet. That silence is the
   proof, and the instant you reach in, the answer is the proof again.

   Tex speaks ONLY when it has something for you. On open it speaks the
   most urgent true thing, once, then returns to silence:

     FALTERING  (first, always) Tex's own integrity failed — the
                evidence chain broke, an agent went dark, Tex can no
                longer prove what it claims. It speaks first, unprompted,
                the instant it can. Silence while broken is a lie told in
                the most dangerous window. This is the witness confessing.

     HELD       a decision is reserved for a human. Tex froze an action
                it will not take on its own authority (an ABSTAIN) and
                surfaces it, in its own voice, with the facts that matter
                and the resolved acts that seal it. A wire transfer is
                not approved by a spoken "yes" — it is sealed by a named
                human act the evidence layer can prove. So the held state
                carries approve / hold / refuse, and resolving it writes
                a sealed decision. This is the governor asking permission.

     PRESENCE   nothing is faltering, nothing waits on you. Opening is a
                reach, so Tex answers the reach the same way it answers a
                press in silence: one word — "Here." — that lands and
                fades, and the paper goes empty. No report, no count, no
                catch. What it governed while you were gone is not news;
                if you want it, you reach and ask. The silence after
                "Here" is the proof that nothing needs you. (When the
                wire is dead, Tex does not say "Here" — it cannot, and
                the still breath already told you.)

   The ask gesture lives everywhere: press and hold ANYWHERE on the
   surface to address Tex. No wake word, no hot mic — Tex listens only
   while held. In silence, holding opens the mic and Tex answers,
   grounded only in sealed facts. In held and faltering, Tex's voice
   speaks first, then the mic opens.

   The wordless reach: if you press and hold in silence and say nothing
   — a check-in, not a question — Tex answers with one word: "Here."
   Presence, confirmed, only because you sought it. That is the cure for
   "is it on": not a status light on the resting screen, but an instant
   answer the moment you reach. (When the wire is dead, Tex does not say
   "Here" — it cannot, and the still breath already told you.)
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

/* "Here." is one word — it lands and leaves faster than an answer. The
   same word answers a reach in silence and a fresh open; one vocabulary
   for presence, however you arrive. */
const HERE_LINE_MS = 2_400;

/* Demo choreography only. On open Tex says "Here." (~HERE_LINE_MS), the
   paper goes empty, then this long after the word clears a held decision
   arrives — so the full arc (presence → silence → a real decision →
   resolution → silence) is visible without a backend. A real build never
   schedules this; the wire delivers human_decision whenever it comes. */
const DEMO_ABSTAIN_AFTER_HERE_MS = 5_000;

/* Demo: the abstain — a frozen action Tex will not rule on alone. This
   is what a real /v1/vigil human_decision carries; here it is summoned
   by the open choreography above (and by the dev panel) to review the
   held flow. Remove the demo wiring before ship; the shape is the
   contract. */
const DEMO_ABSTAIN = {
  id: "dec_9f3a71c2",
  sentence: "I need to know if I can send this wire transfer.",
  detail:
    "$48,000 to an account I'm seeing for the first time today. The payments agent asked to send it four seconds ago. I froze it.",
  /* The sealed facts the proof rests on. */
  anchor_sha256: "b7e23ec29af22b0b4e0d8f6c1a93d5f8c2e1a04d9b3f7c6e",
  agent: "payments-agent-03",
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

  /* Dev override for the wire's liveness, toggled from the dev panel:
     null = real heartbeat, "lost" = force the still breath. */
  const [wireOverride, setWireOverride] = useState(null);

  /* The real breath. true → Tex is alive on the wire and the surface
     breathes. false → the wire is gone and the breath holds still. */
  const alive = useHeartbeat(wireOverride);

  /* The demo abstain — summoned by the open choreography below, after
     "Here" has landed and the paper has gone quiet. A real build gets
     this from vigil.human_decision and never sets it here. */
  const [demoDecision, setDemoDecision] = useState(null);
  const openHandledRef = useRef(false);

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

  /* ---------------- Faltering speaks first, unprompted ---------------- */
  useEffect(() => {
    if (state !== "faltering") return;
    clearLineTimer();
    setSpoken({ kind: "falter", text: falterLine(snapshot) });
    return clearLineTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /* ---------------- The wordless reach: "Here." ---------------- */
  /* You held the surface and said nothing. Not an error — a check-in.
     Tex answers the reach with one word and returns to silence. Only
     when alive; a dead wire cannot speak, and the still breath has
     already answered. */
  const sayHere = useCallback(() => {
    clearLineTimer();
    setSpoken({ kind: "here", text: "Here." });
    texSpeak("Here.");
    lineTimer.current = setTimeout(() => setSpoken(null), HERE_LINE_MS);
  }, []);

  /* ---------------- Open: presence, then (demo) a decision arrives ----------------
     Opening is a reach. With nothing faltering and nothing held, Tex
     answers the open the same way it answers a press in silence: "Here."
     — then the paper goes empty. No report, no count. (Faltering and held
     own their own effects above/below and take precedence; this only
     speaks into a silent, living open.)

     The scheduled abstain below is DEMO ONLY — it lets the full arc be
     seen without a backend: Here → silence → a held decision → you
     resolve it → silence. A real build deletes this timer; the wire
     delivers human_decision on its own clock. */
  useEffect(() => {
    if (openHandledRef.current) return;
    if (override) return; /* dev override owns the surface */
    openHandledRef.current = true;

    if (state === "silent" && alive) sayHere();

    const t = setTimeout(() => {
      setDemoDecision(DEMO_ABSTAIN);
    }, HERE_LINE_MS + DEMO_ABSTAIN_AFTER_HERE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    /* Whether this release should be answered with "Here": only a reach
       made in silence, and only while Tex is actually alive to answer. */
    const reachInSilence = state === "silent" && alive;

    /* The mic never opened (denied, no grant, unsupported). The gesture
       still happened, so a silent reach is still answered. */
    if (!listener) {
      if (reachInSilence) sayHere();
      return;
    }

    setThinking(true);
    listener
      .stop()
      .then((transcript) => {
        setThinking(false);
        if (!transcript) {
          /* Held, said nothing. Answer the reach. */
          if (reachInSilence) sayHere();
          return undefined;
        }
        return askTex(transcript).then((res) => {
          const text = res?.answer || null;
          if (text) {
            setSpoken({ kind: "answer", text });
            texSpeak(text);
            clearLineTimer();
            lineTimer.current = setTimeout(() => setSpoken(null), ANSWER_LINE_MS);
          } else if (reachInSilence) {
            /* Backend had nothing to add — still answer the reach. */
            sayHere();
          }
        });
      })
      .catch(() => setThinking(false));
  }, [holding, state, alive, sayHere]);

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
    const lost = !alive ? " is-lost" : "";
    return `${base} ${s}${listening}${think}${lost}`;
  }, [state, holding, thinking, alive]);

  const ariaState = !alive
    ? "Tex is no longer responding. The connection to the witness was lost."
    : state === "held"
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
      {/* A lost wire is the one death Tex cannot speak. For anyone who
          cannot see the still breath, the interface — not Tex — reports
          the dropped channel, politely, off the visible paper. */}
      {!alive && (
        <p className="tex-visually-hidden" role="status" aria-live="assertive">
          The connection to Tex was lost. It can no longer prove what it
          sees. Do not trust the surface until it returns.
        </p>
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
          <button
            type="button"
            className={wireOverride === "lost" ? "is-active" : ""}
            onClick={() =>
              setWireOverride(wireOverride === "lost" ? null : "lost")
            }
          >
            wire lost
          </button>
        </div>
      )}
    </section>
  );
}
