import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./Vigil.css";
import { useVigil } from "../../hooks/useVigil";
import { useSystemState } from "../../hooks/useSystemState";
import { useHeartbeat } from "../../hooks/useHeartbeat";
import { useIgnition } from "../../hooks/useIgnition";
import { askTex } from "../../lib/texApi";
import {
  TexListener,
  texSpeak,
  texPlayClip,
  stopSpeaking,
} from "../../lib/texVoiceClient";

/* ------------------------------------------------------------------ */
/* PRESENTER MODE — the live demo, driven by number keys.              */
/*                                                                     */
/* For walking someone through Tex with no client wired. Opens on      */
/* silence (the cold open), hides the day-one door, and maps 1–5 to    */
/* the demo beats — each plays the matching authored clip in Tex's     */
/* voice. No dev panel, no visible mechanism: you speak the question    */
/* aloud ("Tex, ...") and press the key as you finish, and Tex answers.*/
/*                                                                     */
/*   1  "Tex, are you watching?"            → "I am here."             */
/*   2  "Tex, show me the disbursement agent." → ap-disbursement-03    */
/*   3  (the $48k hold surfaces — the reveal)  → then click Approve    */
/*   4  "Tex, prove it."                    → the anchor rises         */
/*   5  (the faltering confession — the close)                         */
/*   0 / Esc  → back to silence (reset between runs)                   */
/*                                                                     */
/* Set to false to restore the real surface.                          */
const PRESENTER = true;

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

   The answer is SPOKEN, never written. Meaning lives in the voice; the
   glass stays clean. The screen never holds an answer. The single thing
   it is ever allowed to hold is an OBJECT — a handle you grab and walk
   away with: a hash, an exact identifier like bedrock-invoke-03. You
   don't comprehend a hash, you take it. So when a question's true target
   is such a handle, that handle — and nothing else — rises alone,
   monospace, centered, because you reached for it, and dissolves the
   moment it has been taken. "Show me the Bedrock agent" is answered with
   the worry underneath it, spoken — "Quiet since four, reads three
   buckets, touches nothing else, it's fine" — never with a view. There
   is no agent screen. You drill by speaking, not by scrolling.

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
    decision?.hold?.sentence ||
    decision?.sentence ||
    "I need to know if I can let this through. It's yours to decide."
  );
}
function heldDetail(decision) {
  return decision?.hold?.detail || decision?.detail || null;
}

/* The hold — Tex's abstention made first-class (Layer 4). The card renders
   the TYPE (whether more information could resolve it) and, when the hold is
   epistemic, the single pivotal QUESTION that would resolve it. Meaning is
   spoken; this is the one place the held card is allowed to carry the facts
   and the acts that seal them. */
function heldHold(decision) {
  return decision?.hold || null;
}

/* The typed line: one short, plain phrase. Epistemic = a fact would settle
   it; aleatoric = the call is genuinely the human's; mixed = both pull. Kept
   to the voice's register — never a dashboard label. */
function heldTypeLine(hold) {
  if (!hold) return null;
  switch (hold.hold_type) {
    case "EPISTEMIC":
      return "There's one thing I'd need to know.";
    case "ALEATORIC":
      return "No fact settles this — it's a judgment, and it's yours.";
    case "MIXED":
      return "Part of this I could resolve; part of it is your call.";
    default:
      return null;
  }
}

/* The resolving question — the single pivotal fact, phrased as the question
   it answers. Only present on an epistemic / mixed hold. */
function heldQuestion(hold) {
  if (!hold || !hold.resolving_question) return null;
  return hold.resolving_question;
}

/* The certified-band watermark. Only rendered when the two-sided CRC band
   carries a LIVE guarantee for this hold (band_certified). Honest by default:
   when the gate has no calibration yet, there is no watermark — Tex never
   shows a guarantee it cannot stand behind. The band is chrome, not
   decoration: it derives from the real cutoffs the certificate signs. */
function heldCertifiedWatermark(hold) {
  if (!hold || !hold.band_certified) return null;
  const lo = Number(hold.band_lower).toFixed(2);
  const hi = Number(hold.band_upper).toFixed(2);
  return `certified hold · band [${lo}, ${hi}]`;
}
function falterLine(snapshot) {
  const chain = snapshot?.chain ?? {};
  const at = chain.broke_at || chain.last_sealed_at || null;
  if (at) {
    return `My evidence chain broke at ${at}. I can't prove what I've sealed since. Don't trust me until this is resolved.`;
  }
  return "My evidence chain broke. I can't prove what I've sealed since. Don't trust me until this is resolved.";
}

/* An answer is never written. Meaning is spoken; the glass stays clean.
   The only thing the screen is ever allowed to hold is an OBJECT — a
   handle you grab and walk away with, a hash or an exact identifier.
   You don't comprehend a hash, you take it; so it surfaces as itself and
   dissolves the moment it has been taken. This is how long it lingers —
   long enough to read or copy, then gone. */
const OBJECT_LINGER_MS = 6_000;

/* "Here." is one word — presence, not an answer. The same word answers a
   reach in silence and a fresh open; one vocabulary for presence,
   however you arrive. */
const HERE_LINE_MS = 2_400;

/* The day-one ignition line — "You have forty-one agents running. I'll
   begin." — is a fuller sentence than "Here.", and it is the one line §1
   permits the surface to hold on open: the count, and that Tex is
   beginning. It lingers a beat longer, then the glass goes clean and the
   live vigil takes over. Said once, ever (the server-side flag enforces
   it); never replayed. */
const IGNITE_LINE_MS = 4_600;

/* The day-one open — the manifesto. Tex introduces itself in a short
   litany: each line rotates in, holds, and rotates out, the next taking
   its place, until the last line — the question — arrives and stays with
   the two acts beneath it. Fires on the day-one threshold; the preview
   flag in useIgnition replays it on every load. */
const MANIFESTO = [
  "Hi, I am Tex.",
  "I am always awake.",
  "I am always here.",
  "Hold anywhere to speak with me.",
  "Let's begin mapping.",
];
/* How long each declarative line owns the glass — long enough to read,
   then it gives way. The final line (the question) does not cycle out.
   Keep in sync with the tex-door-cycle duration in Vigil.css. */
const MANIFESTO_BEAT_MS = 2_400;

/* The estate report — spoken when the presenter's "Mapping…" resolves
   (see the mapping effect). Tex states the scale, the active claim (it
   rules on every move — permit/forbid/abstain, never named), and the
   payoff (you only hear from it when one needs you), then the field
   settles into the silence that IS the all-clear.
   ⚠ MUST MATCH /audio/demo/estate.mp3 WORD FOR WORD — text and voice are
   the same authored line; if the render differs, change this string. */
const ESTATE_LINE =
  "Forty-seven agents. Every move they make, I rule on. You only hear from me when one needs you.";
/* The clip runs ~5.7s; the line lingers a breath past it, then dissolves. */
const ESTATE_LINE_MS = 6_800;

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
  sentence: "I'm holding this.",
  detail:
    "$48,000 to an account I'm seeing for the first time today. AP-disbursement-03 tried to move it moments ago. I froze it.",
  /* The sealed facts the proof rests on. */
  anchor_sha256: "b7e23ec29af22b0b4e0d8f6c1a93d5f8c2e1a04d9b3f7c6e",
  agent: "ap-disbursement-03",
  dimension: "execution",
  requires_human: true,
  /* The first-class hold — exactly the shape /v1/vigil delivers. This one is
     epistemic: a fact exists that would resolve it (is this recipient known?),
     so Tex names the question rather than dumping the case on you. The band is
     certified here to show the watermark in preview; a live deployment shows it
     only once Layer-6 outcomes calibrate the gate. */
  hold: {
    hold_type: "EPISTEMIC",
    resolution_mode: "HUMAN_FACT",
    resolving_question:
      "whether this recipient account has ever been paid before",
    epistemic_score: 0.82,
    aleatoric_score: 0.18,
    band_certified: true,
    band_lower: 0.38,
    band_upper: 0.64,
    final_score: 0.5,
  },
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

  /* The day-one threshold. Server-authoritative: whether Tex has begun
     lives in the backend, not localStorage. While the status read is in
     flight the surface renders nothing (silence is the resting truth, not
     a spinner), so a returning operator never sees a flash of the door. */
  const ignition = useIgnition();

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

  /* Which line of the day-one manifesto is on the glass (see MANIFESTO). */
  const [manifestoStep, setManifestoStep] = useState(0);

  /* Presenter mode only: whether the manifesto opener is currently playing.
     Started by the ` key (or 9), it rotates the five lines with their clips,
     then dissolves to silence so the number-key arc can begin. */
  const [presenterDoorOpen, setPresenterDoorOpen] = useState(false);

  /* Presenter mode only: the "Mapping…" working state. Clicking Yes on the
     opener sets this true; it holds the field for ~10s with a growing
     ellipsis, then dissolves to silence. mapDots cycles 1→2→3→1 to read as
     work in progress. */
  const [mapping, setMapping] = useState(false);
  const [mapDots, setMapDots] = useState(1);

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

  /* ---------------- The object — the one thing the screen may hold ----------------
     An answer is never written; meaning is spoken and the glass stays
     clean. The single exception is an OBJECT — a handle you grab and walk
     away with: a hash, an exact identifier like bedrock-invoke-03. It
     isn't information to comprehend, it's a thing to take. So it rises
     alone, monospace, centered, only because you reached for it, and
     dissolves the moment it has been taken. { value, kind: "hash"|"name" } */
  const [surfaced, setSurfaced] = useState(null);
  const objectTimer = useRef(null);
  const clearObjectTimer = () => {
    if (objectTimer.current) clearTimeout(objectTimer.current);
    objectTimer.current = null;
  };
  const surfaceObject = useCallback((value, kind) => {
    if (!value) return;
    clearObjectTimer();
    setSurfaced({ value, kind: kind || "hash" });
    objectTimer.current = setTimeout(() => setSurfaced(null), OBJECT_LINGER_MS);
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
    /* The day-one door owns the open. Wait until the ignition status has
       resolved, and don't run the presence/demo choreography while the
       greeting is up — begin()/dismiss() claim the open themselves. */
    if (!ignition.ready) return;
    if (ignition.doorOpen) return;
    openHandledRef.current = true;

    if (state === "silent" && alive) sayHere();

    const t = setTimeout(() => {
      setDemoDecision(DEMO_ABSTAIN);
    }, HERE_LINE_MS + DEMO_ABSTAIN_AFTER_HERE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ignition.ready, ignition.doorOpen]);

  /* ---------------- The day-one threshold: begin / not yet ----------------
     Tex says hello once and offers to begin discovery. "Begin discovery."
     fires ignition on the backend (said once, ever) and Tex speaks the one
     line it is allowed to hold on open — the count, and that it is
     beginning — then the glass goes clean and the live vigil takes over.
     "Not yet" closes the greeting for this session without firing, so Tex
     greets again next time; it does not nag again now. Both claim the open
     so the presence/demo choreography above stays silent. */
  const beginButtonRef = useRef(null);

  const beginDiscovery = useCallback(async () => {
    openHandledRef.current = true; /* claim the open: no "Here.", no demo */
    const line = await ignition.begin();
    if (line) {
      clearLineTimer();
      setSpoken({ kind: "ignite", text: line });
      texSpeak(line);
      lineTimer.current = setTimeout(() => setSpoken(null), IGNITE_LINE_MS);
    }
    /* line === null → already ignited or a failed reach; the door state in
       the hook decides whether to stay (retry) or fall through to silence. */
  }, [ignition]);

  const deferDiscovery = useCallback(() => {
    openHandledRef.current = true; /* rest in silence; Tex does not nag */
    ignition.dismiss();
  }, [ignition]);

  /* Presenter only — the opener's two acts.
     No  → cross straight into the silent resting field (Tex defers; the
           scripted demo has no backend ignition to fire).
     Yes → Tex begins mapping: the manifesto gives way to a ~10s "Mapping…"
           working state (see the mapping effect below), then settles into
           silence. */
  const crossThreshold = useCallback(() => {
    stopSpeaking();
    setPresenterDoorOpen(false);
  }, []);

  const beginMapping = useCallback(() => {
    stopSpeaking();
    setPresenterDoorOpen(false);
    setMapDots(1);
    setMapping(true);
  }, []);

  /* Move focus to the primary act when the question line arrives (the
     acts only exist on the final manifesto beat), so the threshold is
     crossable from the keyboard the same way it is by pointer. */
  useEffect(() => {
    if (
      ignition.ready &&
      ignition.doorOpen &&
      manifestoStep >= MANIFESTO.length - 1 &&
      beginButtonRef.current
    ) {
      beginButtonRef.current.focus();
    }
  }, [ignition.ready, ignition.doorOpen, manifestoStep]);

  /* The "Mapping…" working state (presenter, after Yes). While it runs, the
     ellipsis grows 1→2→3→1 on a steady tick to read as work in progress;
     after ~10s mapping clears and Tex speaks the estate report (ESTATE_LINE
     + the estate clip), then the field settles into silence. */
  useEffect(() => {
    if (!mapping) return;
    const tick = setInterval(() => setMapDots((d) => (d % 3) + 1), 450);
    const done = setTimeout(() => {
      setMapping(false);
      setSpoken({ kind: "ignite", text: ESTATE_LINE });
      texPlayClip("estate");
      clearLineTimer();
      lineTimer.current = setTimeout(() => setSpoken(null), ESTATE_LINE_MS);
    }, 10_000);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [mapping]);

  /* ---------------- The ask gesture: press and hold anywhere ---------------- */
  const listenerRef = useRef(null);

  const beginHold = useCallback(
    (e) => {
      /* Presenter mode drives everything from number keys; a stray press on
         the surface must do nothing (no mic, no re-speak). */
      if (PRESENTER) return;
      /* Don't start a hold when pressing an actual decision button. */
      if (e && e.target && e.target.closest && e.target.closest("[data-act]")) {
        return;
      }
      /* The ask gesture is inert until the day-one door is resolved and
         closed. There is nothing sealed to ask about before discovery has
         begun, and holding must not open a mic over the greeting. */
      if (!ignition.ready || ignition.doorOpen) return;
      clearLineTimer();
      clearObjectTimer();
      setSurfaced(null);
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
    [state, liveDecision, snapshot, ignition.ready, ignition.doorOpen]
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
          const answer = res?.answer || null;
          if (answer) {
            /* Meaning is spoken, always — and never written. The answer
               leaves no ink. If the answer's true target is an object you
               must carry away (a hash, an exact name), that handle — and
               only that handle — surfaces on the glass, then dissolves. */
            texSpeak(answer);
            if (res?.object?.value) {
              surfaceObject(res.object.value, res.object.kind);
            }
          } else if (reachInSilence) {
            /* Backend had nothing to add — still answer the reach. */
            sayHere();
          }
        });
      })
      .catch(() => setThinking(false));
  }, [holding, state, alive, sayHere, surfaceObject]);

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
      /* Presenter: Tex says the seal aloud as the line lands. The clip is
         the approved verdict ("Sealed. You approved it."), so it fires only
         on Approve — Keep holding / Refuse stay silent. */
      if (PRESENTER && verdict === "approved") texPlayClip("sealed");
      /* Clear the decision so the state falls back to silent under the seal. */
      setDemoDecision(null);
      setOverride(null);
      /* The seal lingers, then silence reclaims the screen. */
      clearLineTimer();
      lineTimer.current = setTimeout(() => setSealed(null), 4_200);
    },
    [liveDecision]
  );

  /* ---------------- Presenter mode: number keys drive the demo ---------------- */
  useEffect(() => {
    if (!PRESENTER) return;

    /* Clear whatever beat is on screen before the next one lands, so beats
       can be fired in any order without bleeding into each other. */
    const reset = () => {
      stopSpeaking();
      clearLineTimer();
      clearObjectTimer();
      setSealed(null);
      setOverride(null);
      setDemoDecision(null);
      setSpoken(null);
      setSurfaced(null);
      setMapping(false);
      setPresenterDoorOpen(false);
    };

    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;

      /* Spacebar — the opener. One press starts the manifesto: the five
         lines play in sequence with their clips and matching text, then
         dissolve to silence. This first press also arms browser audio. */
      if (e.code === "Space" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        reset();
        setManifestoStep(0);
        setPresenterDoorOpen(true);
        return;
      }

      switch (e.key) {
        case "`": /* fallback opener (manifesto) */
          e.preventDefault();
          reset();
          setManifestoStep(0);
          setPresenterDoorOpen(true);
          break;
        case "1": /* "Tex, are you watching?" */
          e.preventDefault();
          reset();
          setSpoken({ kind: "here", text: "I am here." });
          texPlayClip("here");
          lineTimer.current = setTimeout(() => setSpoken(null), 4_000);
          break;
        case "2": /* "Tex, show me the disbursement agent." */
          e.preventDefault();
          reset();
          texPlayClip("agent");
          /* The spoken worry lands by voice; the handle is the one thing the
             glass holds — it rises, then dissolves. */
          surfaceObject("ap-disbursement-03", "name");
          break;
        case "3": /* the $48k hold surfaces — the reveal */
          e.preventDefault();
          reset();
          setDemoDecision(DEMO_ABSTAIN);
          texPlayClip("held");
          break;
        case "4": /* "Tex, prove it." — the anchor rises */
          e.preventDefault();
          reset();
          texPlayClip("prove");
          surfaceObject(DEMO_ABSTAIN.anchor_sha256, "hash");
          break;
        case "5": /* the faltering confession — the close */
          e.preventDefault();
          reset();
          setOverride("faltering");
          texPlayClip("faltering");
          break;
        case "0":
        case "Escape": /* back to silence between runs */
          e.preventDefault();
          reset();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    clearObjectTimer();
    setSurfaced(null);
  };

  /* Demo the answer doctrine without a backend: a question Tex hears,
     answered by voice. "count" is pure meaning — Tex speaks, the glass
     stays clean. "agent" and "prove" each leave one object behind — the
     handle you grab and walk away with — which rises, then dissolves. */
  const devAsk = (kind) => {
    setSealed(null);
    setOverride(null);
    setDemoDecision(null);
    setSpoken(null);
    clearLineTimer();
    stopSpeaking();
    if (kind === "count") {
      texSpeak(
        "Forty-one agents. Three more than yesterday — all on the data team."
      );
    } else if (kind === "agent") {
      texSpeak(
        "Bedrock-invoke-03. Quiet since four. Reads three buckets, touches nothing else. It's fine."
      );
      surfaceObject("bedrock-invoke-03", "name");
    } else if (kind === "prove") {
      texSpeak(
        "Sealed at 7:48 this morning. Payments-agent-03. Here's the anchor."
      );
      surfaceObject(DEMO_ABSTAIN.anchor_sha256, "hash");
    }
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
    : ignition.ready && ignition.doorOpen
    ? "Tex is ready to begin discovery. Begin, or not yet."
    : state === "held"
    ? "Tex is holding a decision for you."
    : state === "faltering"
    ? "Tex's integrity has failed."
    : "Tex, watching. Press and hold anywhere to speak.";

  const decision = liveDecision;

  /* The day-one door owns the surface until it is crossed — except a
     broken chain, which Tex must confess first (you don't greet over a
     faltering witness). In presenter mode the ignition door is bypassed;
     the manifesto opener is owned by presenterDoorOpen instead. */
  const doorOpen = PRESENTER
    ? presenterDoorOpen && state !== "faltering"
    : ignition.ready && ignition.doorOpen && state !== "faltering";

  /* The manifesto plays while the door is open: advance through the
     declarative lines on a steady beat. The last line ("Let's begin
     mapping.") holds and shows the Yes/No acts beneath it — in both the
     real product and the presenter demo. In presenter mode each line also
     plays its clip (m1..m5) as it lands. */
  useEffect(() => {
    if (!doorOpen) {
      setManifestoStep(0);
      return;
    }
    /* Presenter: speak the current line's clip as it lands. */
    if (PRESENTER) texPlayClip(`m${manifestoStep + 1}`);

    if (manifestoStep >= MANIFESTO.length - 1) {
      /* Last line ("Let's begin mapping."). Both the real product and the
         presenter demo hold here and show the Yes/No acts beneath it. The
         presenter crosses the threshold by clicking Yes/No (or pressing a
         number key / 0 / Esc), never on a timer, so the opener can rest on
         screen as long as the room needs. */
      return;
    }
    const t = setTimeout(
      () => setManifestoStep((s) => s + 1),
      MANIFESTO_BEAT_MS
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doorOpen, manifestoStep]);

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

      {/* The day-one threshold — Tex says hello, once, and offers to begin
          discovery. "Begin discovery." fires ignition on the backend (said
          once, ever); "Not yet" leaves it unfired so Tex greets again next
          time. The buttons carry data-act so a press on them never opens
          the ask mic. */}
      {/* The day-one threshold — the manifesto. Tex introduces itself in a
          short litany: each line rotates in, holds, and rotates out, the
          next taking its place, until the final line — the question —
          arrives and stays with the two acts beneath it. "Yes" fires
          ignition on the backend (said once, ever); "No" leaves it unfired
          so Tex greets again next time. The acts carry data-act so a press
          on them never opens the ask mic. */}
      {doorOpen && (
        <div className="tex-door" role="group" aria-label="Begin mapping">
          <p
            key={manifestoStep}
            className={
              manifestoStep >= MANIFESTO.length - 1
                ? "tex-door-sentence tex-door-line tex-door-line--hold"
                : "tex-door-sentence tex-door-line"
            }
          >
            {MANIFESTO[manifestoStep]}
          </p>
          {manifestoStep >= MANIFESTO.length - 1 && (
            <div className="tex-acts tex-door-acts">
              <button
                ref={beginButtonRef}
                type="button"
                data-act="begin"
                className="tex-act tex-act--approve"
                disabled={!PRESENTER && ignition.igniting}
                onClick={PRESENTER ? beginMapping : beginDiscovery}
              >
                Yes
              </button>
              <button
                type="button"
                data-act="defer"
                className={PRESENTER ? "tex-act tex-act--hold" : "tex-act"}
                disabled={!PRESENTER && ignition.igniting}
                onClick={PRESENTER ? crossThreshold : deferDiscovery}
              >
                No
              </button>
            </div>
          )}
        </div>
      )}

      {/* The mapping working state (presenter, after Yes). Tex is already
          awake and watching, so "mapping" is it showing its work, not a
          cold scan: the field holds with a growing ellipsis, then settles
          into silence. Layout/typography borrow the door so it rises and
          centers the same way the manifesto did. */}
      {PRESENTER && mapping && (
        <div
          className="tex-door"
          role="status"
          aria-live="polite"
          aria-label="Mapping the estate"
        >
          <p className="tex-door-sentence tex-mapping">
            Mapping
            <span className="tex-mapping-dots" aria-hidden="true">
              {".".repeat(mapDots)}
            </span>
          </p>
        </div>
      )}

      {/* The held decision — Tex's voice, the facts, the resolved acts. */}
      {!doorOpen && state === "held" && decision && !sealed && (
        <div className="tex-held">
          <p className="tex-held-sentence">{heldSentence(decision)}</p>
          {heldDetail(decision) && (
            <p className="tex-held-detail">{heldDetail(decision)}</p>
          )}
          {/* The hold, made legible: the type (whether a fact could resolve
              it) and — when epistemic — the single pivotal question. Meaning
              is spoken; this is the one surface allowed to carry the facts
              and the acts that seal them. */}
          {heldHold(decision) && (
            <div className="tex-held-hold">
              {heldTypeLine(heldHold(decision)) && (
                <p className="tex-held-type">
                  {heldTypeLine(heldHold(decision))}
                </p>
              )}
              {heldQuestion(heldHold(decision)) && (
                <p className="tex-held-question">
                  {heldQuestion(heldHold(decision))}
                </p>
              )}
            </div>
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
          {/* The certified-band watermark — chrome, not decoration; rendered
              only when the two-sided CRC band carries a live guarantee. */}
          {heldCertifiedWatermark(heldHold(decision)) && (
            <p className="tex-held-cert" aria-hidden="true">
              {heldCertifiedWatermark(heldHold(decision))}
            </p>
          )}
          {!PRESENTER && (
            <p className="tex-held-ask" aria-hidden="true">
              press and hold anywhere to ask Tex about it
            </p>
          )}
        </div>
      )}

      {/* The voice — Tex speaks; the glass stays clean. An answer is
          never written. The only spoken lines that touch the paper are
          presence ("Here.") and the faltering warning — and only because
          those are states Tex is in, not answers to a question. */}
      {!doorOpen && state !== "held" && !sealed && (
        <div className="tex-voice" aria-live="polite">
          {spoken &&
            (spoken.kind === "here" ||
              spoken.kind === "falter" ||
              spoken.kind === "ignite") && (
              <p
                className={`tex-voice-line tex-voice-line--${spoken.kind}`}
                key={spoken.text}
              >
                {spoken.text}
              </p>
            )}
        </div>
      )}

      {/* The object — the one thing the screen is ever allowed to hold: a
          handle you grab and walk away with. It rises alone, monospace,
          centered, only because you reached for it, and dissolves the
          moment it has been taken. You don't comprehend a hash — you take
          it. Meaning is spoken; an object is shown. */}
      {!doorOpen && state !== "held" && !sealed && surfaced && (
        <div className="tex-object" role="status" aria-live="polite">
          <span className="tex-object-value" key={surfaced.value}>
            {surfaced.value}
          </span>
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
          <span className="tex-dev-panel-label">ask</span>
          <button type="button" onClick={() => devAsk("count")}>
            count
          </button>
          <button type="button" onClick={() => devAsk("agent")}>
            agent
          </button>
          <button type="button" onClick={() => devAsk("prove")}>
            prove
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
