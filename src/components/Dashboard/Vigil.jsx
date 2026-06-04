import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import "./Vigil.css";
import { useVigil } from "../../hooks/useVigil";
import { useSystemState } from "../../hooks/useSystemState";
import { useHeartbeat } from "../../hooks/useHeartbeat";
import { useIgnition } from "../../hooks/useIgnition";
import { askTex, sealDecision, explainLine, approveProposal, rejectProposal } from "../../lib/texApi";
import { TexListener, texSpeak, stopSpeaking } from "../../lib/texVoiceClient";

/* ==================================================================
   Vigil — the entire product surface. Live.

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
   something for you. The absence of speech is not absence of life.

   On open it speaks the most urgent true thing, once, then returns to
   silence:

     FALTERING  (first, always) Tex's own integrity failed — the
                evidence chain broke, Tex can no longer prove what it
                claims. It speaks first, unprompted, the instant it can.

     HELD       a decision is reserved for a human — an ABSTAIN Tex
                froze and will not rule on alone. It surfaces it in its
                own voice with the facts that matter and the acts that
                seal it. A wire transfer is not approved by a spoken
                "yes" — it is sealed by a named human act the evidence
                layer can prove.

     PRESENCE   nothing faltering, nothing waiting. A wordless reach is
                answered with one word — "Here." — that lands and fades.

   The ask gesture lives everywhere: press and hold ANYWHERE on the
   surface to address Tex. No wake word, no hot mic — Tex listens only
   while held, streams your speech to its own gateway, answers from
   POST /v1/ask (grounded ONLY in sealed facts), and speaks the answer
   back through /v1/speak. The answer is SPOKEN, never written. The
   single thing the glass is ever allowed to hold is an OBJECT — a
   handle you grab and walk away with: a hash, an exact identifier. It
   rises alone, monospace, centered, only because you reached for it,
   and dissolves the moment it has been taken.

   The day-one open: Tex names itself once — "Tex." — then asks to
   begin. "Let's begin mapping." with Yes / No. Yes runs real discovery
   on the backend (the mapping state holds while it works), then Tex
   speaks the count and the glass goes clean. No crosses straight to
   silence.
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
   epistemic, the single pivotal QUESTION that would resolve it. */
function heldHold(decision) {
  return decision?.hold || null;
}

/* A calibration hold is the second kind of held card: not a frozen action,
   but Tex asking to sharpen its own policy after an anytime-valid crossing.
   Distinguished only by hold.kind; same gesture, same seal. */
function isCalibration(decision) {
  return decision?.hold?.kind === "calibration";
}

/* The proposed change, as the one handle the glass may hold when reached for:
   a compact "permit 0.34 → 0.32" the operator reads and takes, never a table. */
function proposedChangeHandle(decision) {
  const c = decision?.hold?.proposed_change;
  if (!c) return null;
  const fmt = (n) => Number(n).toFixed(2);
  const parts = [];
  if (c.permit_before !== c.permit_after) {
    parts.push(`permit ${fmt(c.permit_before)} → ${fmt(c.permit_after)}`);
  }
  if (c.forbid_before !== c.forbid_after) {
    parts.push(`forbid ${fmt(c.forbid_before)} → ${fmt(c.forbid_after)}`);
  }
  if (c.min_confidence_before !== c.min_confidence_after) {
    parts.push(
      `min-conf ${fmt(c.min_confidence_before)} → ${fmt(c.min_confidence_after)}`
    );
  }
  return parts.length ? parts.join("   ·   ") : null;
}

/* The typed line: one short, plain phrase. Epistemic = a fact would settle
   it; aleatoric = the call is genuinely the human's; mixed = both pull. */
function heldTypeLine(hold) {
  if (!hold) return null;
  if (hold.kind === "calibration") return null;
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
   carries a LIVE guarantee for this hold (band_certified). Honest by default. */
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

/* The object — the one thing the screen may hold — lingers long enough to
   read or copy, then dissolves. */
const OBJECT_LINGER_MS = 6_000;

/* "Here." is one word — presence, not an answer. */
const HERE_LINE_MS = 2_400;

/* The day-one ignition line — "You have forty-one agents running. I'll
   begin." — the one fuller sentence the surface holds on open after
   mapping resolves. It lingers a beat, then the glass goes clean and the
   live vigil takes over. */
const IGNITE_LINE_MS = 4_600;

/* The day-one open. Tex names itself, then asks to begin:
     1. "Tex."                 — rises, holds a couple of seconds, then fades
                                  out slowly.
     2. "Let's begin mapping." — eases in and stays, with Yes / No beneath.
   The first line cycles out on MANIFESTO_BEAT_MS; keep that in sync with the
   tex-door-line cycle duration in Vigil.css so the line finishes its slow
   fade exactly as the step advances. The final line does not cycle. */
const MANIFESTO = ["Tex.", "Let's begin mapping."];
const MANIFESTO_BEAT_MS = 2_700;

/* The shortest the "Mapping" state stays up, so a fast backend never makes it
   flash. Real discovery usually takes longer; when it returns sooner than
   this, we hold the field the rest of the beat, then speak the count. */
const MAP_MIN_MS = 1_800;

/* ------------------------------------------------------------------ */
/* State derivation                                                    */
/* ------------------------------------------------------------------ */

function deriveState(liveDecision, snapshot) {
  const chain = snapshot?.chain ?? {};
  const intact =
    (chain.discovery_chain_intact ?? true) &&
    (chain.snapshot_chain_intact ?? true);
  if (snapshot && !intact) return "faltering";

  if (liveDecision) return "held";

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

  /* The real breath. true → Tex is alive on the wire and the surface
     breathes. false → the wire is gone and the breath holds still. */
  const alive = useHeartbeat();

  const openHandledRef = useRef(false);

  /* Which line of the day-one open is on the glass (see MANIFESTO). */
  const [manifestoStep, setManifestoStep] = useState(0);

  /* The "Mapping" working state. Clicking Yes shows it and runs real
     discovery on the backend; it holds the field with a growing ellipsis
     while the wire works, then dissolves to Tex speaking the count. */
  const [mapping, setMapping] = useState(false);
  const [mapDots, setMapDots] = useState(1);
  const mappingTimer = useRef(null);
  const clearMappingTimer = () => {
    if (mappingTimer.current) clearTimeout(mappingTimer.current);
    mappingTimer.current = null;
  };

  /* The resolved act, briefly shown as a seal before returning to
     silence. { verdict: "approved"|"held"|"refused", at, anchor } */
  const [sealed, setSealed] = useState(null);

  /* Optimistic dismissal, reconciled by the stream. When the operator
     resolves a held card (decision or calibration), we add its key here so
     the card clears instantly — no spinner, the surface's whole posture.
     The next /v1/vigil frame is the authoritative truth: approve/refuse make
     the backend drop it (it stays gone); keep-holding writes nothing, so this
     session-local set is what keeps Tex from re-raising it (pull-only). */
  const dismissedRef = useRef(new Set());
  const [, bumpDismissed] = useState(0);
  /* Pending boundary for the resolve mutation. React 18.3 stable: useTransition
     (not useOptimistic, which is React 19) marks the write as non-urgent so
     the optimistic dismiss stays responsive. */
  const [, startTransition] = useTransition();

  const rawHumanDecision = vigil?.human_decision || null;
  /* One dismissal key per held card: a calibration proposal id, or a decision
     id. Once resolved this session, the wire frame for it is filtered out. */
  const dismissKey = rawHumanDecision
    ? isCalibration(rawHumanDecision)
      ? rawHumanDecision.hold?.proposal_id
      : rawHumanDecision.id
    : null;
  const humanDecisionLive =
    rawHumanDecision && dismissKey && dismissedRef.current.has(dismissKey)
      ? null
      : rawHumanDecision;

  const liveDecision = humanDecisionLive || null;
  const state = deriveState(liveDecision, snapshot);

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
     Tex answers the reach with one word and returns to silence. Only when
     alive; a dead wire cannot speak, and the still breath already answered. */
  const sayHere = useCallback(() => {
    clearLineTimer();
    setSpoken({ kind: "here", text: "Here." });
    texSpeak("Here.");
    lineTimer.current = setTimeout(() => setSpoken(null), HERE_LINE_MS);
  }, []);

  /* ---------------- The object — the one thing the screen may hold ---------------- */
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

  /* ---------------- Open: presence for a returning operator ----------------
     Opening is a reach. For an operator whose tenant has already ignited
     (the door is closed) with nothing faltering and nothing held, Tex
     answers the open the same way it answers a press in silence: "Here." —
     then the paper goes empty. While the day-one door is open, the opener
     owns the surface and this stays silent. */
  useEffect(() => {
    if (openHandledRef.current) return;
    if (!ignition.ready) return;
    if (ignition.doorOpen) return;
    openHandledRef.current = true;
    if (state === "silent" && alive) sayHere();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ignition.ready, ignition.doorOpen]);

  /* ---------------- The day-one threshold: begin / not yet ----------------
     Yes  → run REAL discovery on the backend. The "Mapping" state holds the
            field while the wire works; when it returns, Tex speaks the count
            ("You have N agents running. I'll begin.") and the glass clears to
            the live vigil. Said once, ever (server-side flag enforces it).
     No   → cross straight into silence without firing; Tex greets again next
            time and does not nag now. */
  const beginButtonRef = useRef(null);

  const beginMapping = useCallback(async () => {
    openHandledRef.current = true; /* claim the open: no "Here.", no replay */
    stopSpeaking();
    clearLineTimer();
    setSpoken(null);
    setMapDots(1);
    setMapping(true);

    const started = Date.now();
    /* useIgnition.begin() fires POST /v1/surface/discovery/ignite and returns
       the one spoken line — the count of what the scan actually discovered. */
    const line = await ignition.begin();
    const wait = Math.max(0, MAP_MIN_MS - (Date.now() - started));

    clearMappingTimer();
    mappingTimer.current = setTimeout(() => {
      setMapping(false);
      if (line) {
        clearLineTimer();
        setSpoken({ kind: "ignite", text: line });
        texSpeak(line);
        lineTimer.current = setTimeout(() => setSpoken(null), IGNITE_LINE_MS);
      }
    }, wait);
  }, [ignition]);

  const deferDiscovery = useCallback(() => {
    openHandledRef.current = true; /* rest in silence; Tex does not nag */
    ignition.dismiss();
  }, [ignition]);

  /* Move focus to Yes when the question line arrives (the acts only exist on
     the final open beat), so the threshold is crossable from the keyboard. */
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

  /* The "Mapping" ellipsis. While the state runs, the dots grow 1→2→3→1 on a
     steady tick to read as work in progress. Completion is driven by the real
     ignite call in beginMapping, not a timer. */
  useEffect(() => {
    if (!mapping) return;
    const tick = setInterval(() => setMapDots((d) => (d % 3) + 1), 450);
    return () => clearInterval(tick);
  }, [mapping]);

  /* ---------------- The ask gesture: press and hold anywhere ---------------- */
  const listenerRef = useRef(null);

  const beginHold = useCallback(
    (e) => {
      /* Don't start a hold when pressing an actual decision button. */
      if (e && e.target && e.target.closest && e.target.closest("[data-act]")) {
        return;
      }
      /* The ask gesture is inert until the day-one door is resolved and
         closed, and while mapping is running. There is nothing sealed to ask
         about before discovery has begun, and holding must not open a mic
         over the greeting or the mapping state. */
      if (!ignition.ready || ignition.doorOpen || mapping) return;

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
    [state, liveDecision, snapshot, ignition.ready, ignition.doorOpen, mapping]
  );

  /* ---------------- Pulling the evidence ----------------
     The proof depth: when the operator reaches for a held line, Tex finishes
     the story from SEALED facts (/v1/vigil/explain) — meaning is spoken — and
     the one thing the glass is allowed to hold, the sealed anchor, rises as an
     object, then dissolves. Falls back to the anchor the decision carries if
     the explain wire is unreachable. */
  const pullEvidence = useCallback(
    (decision) => {
      if (!decision) return;
      if (isCalibration(decision)) {
        const detail = heldDetail(decision);
        if (detail) texSpeak(detail);
        const handle = proposedChangeHandle(decision);
        if (handle) surfaceObject(handle, "name");
        return;
      }
      explainLine(decision.dimension || null, heldSentence(decision))
        .then((res) => {
          const story = res?.explanation || res?.facts?.headline || null;
          if (story) texSpeak(story);
          const anchor =
            res?.facts?.anchors?.[0]?.sha256 || decision.anchor_sha256 || null;
          if (anchor) surfaceObject(anchor, "hash");
        })
        .catch(() => {
          if (decision.anchor_sha256) {
            surfaceObject(decision.anchor_sha256, "hash");
          }
        });
    },
    [surfaceObject]
  );

  const endHold = useCallback(() => {
    if (!holding) return;
    setHolding(false);

    const listener = listenerRef.current;
    listenerRef.current = null;

    /* Whether this release should be answered with "Here": only a reach made
       in silence, and only while Tex is actually alive to answer. */
    const reachInSilence = state === "silent" && alive;
    /* A reach made while a decision is held is a request for the proof. */
    const reachInHeld = state === "held" && alive && Boolean(liveDecision);

    /* The mic never opened (denied, no grant, unsupported). The gesture still
       happened, so a silent reach is still answered. */
    if (!listener) {
      if (reachInHeld) pullEvidence(liveDecision);
      else if (reachInSilence) sayHere();
      return;
    }

    setThinking(true);
    listener
      .stop()
      .then((transcript) => {
        setThinking(false);
        if (!transcript) {
          if (reachInHeld) pullEvidence(liveDecision);
          else if (reachInSilence) sayHere();
          return undefined;
        }
        return askTex(transcript).then((res) => {
          const answer = res?.answer || null;
          if (answer) {
            /* Meaning is spoken, always — and never written. If the answer's
               true target is an object you must carry away (a hash, an exact
               name), that handle — and only that handle — surfaces, then
               dissolves. */
            texSpeak(answer);
            if (res?.object?.value) {
              surfaceObject(res.object.value, res.object.kind);
            }
          } else if (reachInSilence) {
            sayHere();
          }
        });
      })
      .catch(() => setThinking(false));
  }, [holding, state, alive, sayHere, surfaceObject, pullEvidence, liveDecision]);

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
     A held decision is not approved by a spoken "maybe" — it is sealed by a
     NAMED human act the evidence layer can prove. The seal shows instantly
     (optimistic, no spinner — silence is the failure mode, never a toast),
     then the backend's real anchor + post-quantum signature replace it the
     moment POST /decisions/{id}/seal returns. */
  const resolve = useCallback(
    (verdict) => {
      const decision = liveDecision;
      stopSpeaking();
      setSpoken(null);

      /* The calibration hold resolves through the learning layer, not /seal:
         approving/rejecting a proposal IS its sealed act. */
      if (isCalibration(decision)) {
        const proposalId = decision.hold?.proposal_id;
        const fromWire = Boolean(humanDecisionLive);

        if (proposalId) {
          dismissedRef.current.add(proposalId);
          bumpDismissed((n) => n + 1);
        }
        setSealed({
          verdict,
          at: new Date(),
          anchor: null,
          signature: null,
          calibration: true,
          pending: fromWire && verdict !== "held",
        });
        clearLineTimer();
        lineTimer.current = setTimeout(() => setSealed(null), 4_200);

        if (fromWire && proposalId && verdict !== "held") {
          startTransition(() => {
            const call =
              verdict === "approved"
                ? approveProposal(proposalId, { approver: "operator" })
                : rejectProposal(proposalId, {
                    rejecter: "operator",
                    reason: "declined by operator",
                  });
            call
              .then(() => {
                setSealed((prev) => (prev ? { ...prev, pending: false } : prev));
              })
              .catch(() => {
                /* Silent. The optimistic dismiss stands; the stream reconciles. */
              });
          });
        }
        return;
      }

      /* A held DECISION is sealed by a named human act (POST /seal). Suppress
         the wire frame for it this session so the card never re-raises once
         resolved, while the next frame reconciles authoritatively. */
      if (decision?.id) {
        dismissedRef.current.add(decision.id);
        bumpDismissed((n) => n + 1);
      }
      setSealed({
        verdict,
        at: new Date(),
        anchor: decision?.anchor_sha256 || null,
        signature: null,
        pending: Boolean(decision?.id),
      });
      clearLineTimer();
      lineTimer.current = setTimeout(() => setSealed(null), 4_200);

      if (decision?.id) {
        sealDecision(decision.id, { verdict, resolvedBy: "operator" })
          .then((res) => {
            if (!res) return;
            setSealed((prev) =>
              prev
                ? {
                    ...prev,
                    anchor: res.anchor_sha256 || prev.anchor,
                    signature: res.pq_signature || null,
                    at: res.sealed_at ? new Date(res.sealed_at) : prev.at,
                    pending: false,
                  }
                : prev
            );
            clearLineTimer();
            lineTimer.current = setTimeout(() => setSealed(null), 6_000);
          })
          .catch(() => {
            /* Silent. The optimistic seal stays; the backend was unreachable. */
          });
      }
    },
    [liveDecision, humanDecisionLive]
  );

  /* Tear down any pending timers on unmount. */
  useEffect(() => {
    return () => {
      clearLineTimer();
      clearObjectTimer();
      clearMappingTimer();
    };
  }, []);

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
    ? "Tex is ready to begin mapping. Yes, or not yet."
    : mapping
    ? "Tex is mapping the estate."
    : state === "held"
    ? "Tex is holding a decision for you."
    : state === "faltering"
    ? "Tex's integrity has failed."
    : "Tex, watching. Press and hold anywhere to speak.";

  const decision = liveDecision;

  /* The day-one door owns the surface until it is crossed — except a broken
     chain, which Tex must confess first (you don't greet over a faltering
     witness) — and it yields to the mapping state the instant Yes is pressed,
     so the two never overlap while the ignite call is in flight. */
  const doorOpen =
    ignition.ready && ignition.doorOpen && state !== "faltering" && !mapping;

  /* The open plays while the door is open: advance through the lines on a
     steady beat. "Tex." rises, holds about a second, and dissolves; then
     "Let's begin mapping." arrives and stays with the Yes/No acts beneath it. */
  useEffect(() => {
    if (!doorOpen) {
      setManifestoStep(0);
      return;
    }
    if (manifestoStep >= MANIFESTO.length - 1) {
      /* Final line holds and shows the acts; it never cycles out. */
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
      {/* A lost wire is the one death Tex cannot speak. For anyone who cannot
          see the still breath, the interface — not Tex — reports the dropped
          channel, politely, off the visible paper. */}
      {!alive && (
        <p className="tex-visually-hidden" role="status" aria-live="assertive">
          The connection to Tex was lost. It can no longer prove what it sees.
          Do not trust the surface until it returns.
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
          {sealed.signature && (
            <p className="tex-seal-sig">
              {sealed.signature.post_quantum ? "post-quantum sealed" : "sealed"}
              &nbsp;·&nbsp;{sealed.signature.algorithm}
            </p>
          )}
        </div>
      )}

      {/* The day-one threshold. Tex names itself once — "Tex." — then asks to
          begin: "Let's begin mapping." with Yes / No beneath the final line.
          Yes fires real ignition on the backend (said once, ever); No leaves
          it unfired so Tex greets again next time. The acts carry data-act so
          a press on them never opens the ask mic. */}
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
                disabled={ignition.igniting}
                onClick={beginMapping}
              >
                Yes
              </button>
              <button
                type="button"
                data-act="defer"
                className="tex-act"
                disabled={ignition.igniting}
                onClick={deferDiscovery}
              >
                No
              </button>
            </div>
          )}
        </div>
      )}

      {/* The mapping working state (after Yes). Tex is already awake and
          watching, so "mapping" is it showing its work, not a cold scan: the
          field holds with a growing ellipsis while real discovery runs on the
          backend, then settles into Tex speaking the count. */}
      {mapping && (
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
      {!doorOpen && !mapping && state === "held" && decision && !sealed && (
        <div className="tex-held">
          <p className="tex-held-sentence">{heldSentence(decision)}</p>
          {heldDetail(decision) && (
            <p className="tex-held-detail">{heldDetail(decision)}</p>
          )}
          {heldHold(decision) && (
            <div className="tex-held-hold">
              {heldTypeLine(heldHold(decision)) && (
                <p className="tex-held-type">{heldTypeLine(heldHold(decision))}</p>
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
          {/* The reached handle — the one thing the card may hold. On a
              calibration hold it's the proposed change; on a decision it's the
              sealed anchor. It rises only because you reached (press and hold)
              and dissolves once taken. */}
          {surfaced && (
            <div
              className="tex-object tex-object--in-held"
              role="status"
              aria-live="polite"
            >
              <span className="tex-object-value" key={surfaced.value}>
                {surfaced.value}
              </span>
            </div>
          )}
          {heldCertifiedWatermark(heldHold(decision)) && (
            <p className="tex-held-cert" aria-hidden="true">
              {heldCertifiedWatermark(heldHold(decision))}
            </p>
          )}
          <p className="tex-held-ask" aria-hidden="true">
            press and hold anywhere to ask Tex about it
          </p>
        </div>
      )}

      {/* The voice — Tex speaks; the glass stays clean. An answer is never
          written. The only spoken lines that touch the paper are presence
          ("Here."), the ignition count, and the faltering warning — states
          Tex is in, not answers to a question. */}
      {!doorOpen && !mapping && state !== "held" && !sealed && (
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
          centered, only because you reached for it, and dissolves the moment
          it has been taken. */}
      {!doorOpen && !mapping && state !== "held" && !sealed && surfaced && (
        <div className="tex-object" role="status" aria-live="polite">
          <span className="tex-object-value" key={surfaced.value}>
            {surfaced.value}
          </span>
        </div>
      )}
    </section>
  );
}
