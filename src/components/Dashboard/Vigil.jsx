import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import "./Vigil.css";
import { useVigil } from "../../hooks/useVigil";
import { useSystemState } from "../../hooks/useSystemState";
import { useHeartbeat } from "../../hooks/useHeartbeat";
import { useIgnition } from "../../hooks/useIgnition";
import { askTex, sealDecision, explainLine, approveProposal, rejectProposal, wakeBackend, getAgentRoster } from "../../lib/texApi";
import {
  TexListener,
  texSpeak,
  texSpeakTimed,
  texSpeakSequence,
  stopSpeaking,
  unlockVoice,
  prewarmPresence,
  playPresenceAck,
  VOICE_ENABLED,
} from "../../lib/texVoiceClient";
import SpokenLine from "./SpokenLine";
import { SeeListener, SEE_STT_SUPPORTED } from "../../lib/seeListener";
import {
  derivePresence,
  claimLabel,
  TIER,
  TIER_LABEL,
  TIER_GLOSS,
} from "../../lib/presence";

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

   The open is the day-one arc: Tex declares itself — "I am Tex." — then claims
   dominion — "Nothing happens without me." — then takes the weight — "The weight
   is mine now." with a single Begin act beneath it. Begin is the summons: it runs
   the read-only directory connect, the field holds a beat of empty white (Tex
   taking in the estate, never a spinner) while real discovery runs, then the
   glass clears to the live vigil.
   ================================================================== */

/* ------------------------------------------------------------------ */
/* The deliberation mark — what Tex shows while it weighs the answer    */
/* against what it can prove. Not a borrowed dot: a nascent sha256,     */
/* still searching. Six hex glyphs in the seal's own voice (Geist Mono, */
/* the quietest ink), scrambling on a calm, throttled cadence that reads*/
/* as weighing — never a frantic buffer — then clearing the instant the */
/* answer takes the glass and the real seal surfaces. One object, two   */
/* moments: this is the seal, a breath before it exists.                */
/* ------------------------------------------------------------------ */
const DELIBERATION_HEX = "0123456789abcdef";
const DELIBERATION_LEN = 6;
function randomHexRun() {
  let s = "";
  for (let i = 0; i < DELIBERATION_LEN; i++) {
    s += DELIBERATION_HEX[(Math.random() * 16) | 0];
  }
  return s;
}

function DeliberationMark() {
  const [glyphs, setGlyphs] = useState(randomHexRun);
  useEffect(() => {
    /* Respect reduced motion: hold a still fragment, no scramble. */
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return undefined;
    }
    /* Throttled to ~96ms — deliberate, not a buffer. The interval lives only
       while the mark is mounted (thinking/verifying), so it starts and stops
       with the pause itself. */
    const id = setInterval(() => setGlyphs(randomHexRun()), 96);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="tex-deliberation-mark" aria-hidden="true">
      {glyphs}
    </span>
  );
}

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
  /* The REAL break timestamp the backend now stands behind: snapshot chain's
     offending captured_at, or the discovery chain's offending appended_at. Both
     are null while the chain is intact, so faltering only ever speaks from a
     real break — never a placeholder (the original 2026-06-19 deactivation
     reason). Snapshot is preferred when both broke; this is a confession line,
     not a forensic report. */
  const at = chain.snapshot_broke_at || chain.discovery_broke_at || null;
  if (at) {
    return `My evidence chain broke at ${at}. I can't prove what I've sealed since. Don't trust me until this is resolved.`;
  }
  return "My evidence chain broke. I can't prove what I've sealed since. Don't trust me until this is resolved.";
}

/* The object — the one thing the screen may hold — lingers long enough to
   read or copy, then dissolves. */
const OBJECT_LINGER_MS = 6_000;


/* The interactive answer — shown + lit word-by-word as Tex speaks it, then it
   lingers a beat and dissolves. The one transient exception to "answers are
   spoken, never written": it is never persisted, only voiced-and-gone. */
const ANSWER_LINGER_MS = 2_200;
const ANSWER_FADE_MS = 720;

/* A presence answer carries more than a sentence — a credibility tier, maybe an
   abstain reason, maybe claims you can reach into for their evidence. It earns a
   longer hold than a bare spoken line so the tier can be read and a claim can be
   reached for; any reach (tapping a claim's evidence) re-arms this. Still
   voiced-and-gone — just a longer beat. */
const PRESENCE_LINGER_MS = 9_000;

/* The day-one ignition line — e.g. "You have two hundred agents running.
   I'll begin." — the one fuller sentence the surface holds on open after
   mapping resolves. The count is whatever the backend's real discovery scan
   mapped; the frontend never fabricates it. It is VOICE-DRIVEN: it holds while
   Tex speaks it and clears a read-beat PAST the final word (see beginMapping),
   so it can never vanish mid-sentence the way a fixed timer let it.
     IGNITE_LINE_MS        — the silence FLOOR: when the voice is muted/unreachable
                             (onEnd fires at once) the line still holds this long so
                             it can be read rather than flashing.
     IGNITE_LINE_LINGER_MS — the read-beat held past the last SPOKEN word before the
                             line dissolves, when the voice actually played.
     IGNITE_LINE_CAP_MS    — a defensive cap: if the voice is superseded (onEnd never
                             fires) the line still clears here instead of hanging. */
const IGNITE_LINE_MS = 4_600;
const IGNITE_LINE_LINGER_MS = 1_500;
const IGNITE_LINE_CAP_MS = 20_000;

/* ----------------------------- TYPE TO WRITE -----------------------------
   The specialist path: the dead-mic / can't-speak / exact-token case. You do
   NOT hold to write — hold is the voice reach. A printable keystroke (never a
   space) IS the first letter on desktop; on a touch device ONE tiny resident
   glyph raises the keyboard. The typed line is transient — it reuses the SAME
   grounded path the voice reach uses (askTex → derivePresence → surfaceAnswer),
   is voiced-and-gone, and is NEVER persisted: no transcript, no echo, no send
   button. Default-OFF until shipped; enable for a build with VITE_TEX_TYPING=1.
   The whole path is additive — the proven voice reach is untouched. */
const TYPING_ENABLED = import.meta.env.VITE_TEX_TYPING === "1";

/* The day-one open — the threshold. An arc, shown once, then gone: a being
   declares itself, claims dominion, and takes the weight. Never a rotation —
   it progresses and then ends, into the live surface. Each beat lands on Tex's
   own selfhood (Tex / me / mine): one voice, three self-assertions, escalating.
   No category noun anywhere — Tex does not name "agents" or "networks" on the
   threshold (that would be entering someone else's aisle); it names nothing and
   so swallows everything.
     1. "I am Tex."                — existence. The cognition speaks itself into
                                      the room. Rises, holds, dissolves. Same
                                      weight and warm ink as the lines that
                                      follow, so it reads as the same being —
                                      presence comes from the verb, not the size.
     2. "Nothing happens without    — dominion. The one claim the whole product
         me."                         rests on. "Nothing" (not "your agents")
                                      makes Tex the condition for anything
                                      occurring at all. Holds longest, dissolves.
     3. "The weight is mine now."   — the handover. The arc finally turns to the
                                      operator: your weight, carried by Tex. The
                                      power move and the relief are the same four
                                      words. Arrives and stays, with a single act
                                      (Begin) beneath it — Begin is the gesture of
                                      giving it over. No opt-out: after a line
                                      that absolute, asking permission would hand
                                      the weight back.
   Each cycling line's fade is timed to its own beat (MANIFESTO_BEATS), set
   inline on the line so the rotateX/rise/dissolve finishes exactly as the step
   advances. The final line does not cycle. */
const MANIFESTO = [
  "I am Tex.",
  "Nothing happens without me.",
  "The weight is mine now.",
];
/* The manifesto is now VOICE-DRIVEN: each line stays on the glass while Tex
   speaks it (word-synced), then breathes, then dissolves into the next — the
   audio clock advances the arc, never a fixed timer, so the words can never
   drift from what is heard (see texSpeakSequence). MANIFESTO_BEATS survives only
   as the SILENCE FLOOR: when no audio is reachable (no ElevenLabs, offline), a
   line holds its designed beat so the arc still paces rather than flashing past.
   With the voice MUTED this floor is the ONLY pace there is, so it's tuned to a
   brisk silent-READING beat (not the longer spoken duration, which is just dead
   air with no voice filling it) — fast enough not to drag, slow enough to read.
   The dominion claim (step 1) still holds a touch longest; the final step does not
   cycle, so it needs no entry here (see MANIFESTO_FINAL_HOLD_MS for its hold). */
const MANIFESTO_BEATS = [1_200, 1_500];
/* The held silence after Tex finishes a line, before it dissolves to the next —
   the brief pause that makes a declaration land without stalling the arc. */
const MANIFESTO_BREATH_MS = 400;
/* How long a line takes to dissolve out (kept in sync with the tex-door-leave
   animation in Vigil.css). */
const MANIFESTO_LEAVE_MS = 560;
/* The handover line ("The weight is mine now.") cycles out of nothing — it
   arrives and stays. With the voice muted it has no spoken duration to hold on,
   so this is its silence-floor hold: long enough that the line LANDS and breathes
   before Begin fades in beneath it, instead of handing off the instant it appears.
   (Used as the third silenceHold entry; the spoken path still paces on the voice.) */
const MANIFESTO_FINAL_HOLD_MS = 1_800;

/* The shortest the "Mapping" state stays up, so a fast backend never makes it
   flash. Real discovery usually takes longer; when it returns sooner than
   this, we hold the field the rest of the beat, then speak the count. */
const MAP_MIN_MS = 1_800;

/* ------------------------------------------------------------------ */
/* State derivation                                                    */
/* ------------------------------------------------------------------ */

function deriveState(liveDecision, snapshot) {
  /* FALTERING RE-ENABLED (2026-06-26, D5) — the canned "My evidence chain broke…"
     confession was deactivated 2026-06-19 because it fired as a PLACEHOLDER (the
     generic, timestamp-less form): the backend gave the booleans below but no
     real break timestamp the surface could stand behind. The backend now emits an
     explicit chain.snapshot_broke_at / chain.discovery_broke_at — the real
     captured_at / appended_at of the breaking record, null while the chain is
     intact — so faltering speaks only from a real, timestamped break, never a
     scripted doom line. falterLine reads those real fields. This adds NO new
     unsolicited surface: faltering/"Tex is down" is one of the two sanctioned
     unsolicited surfaces (the other is HELD). */
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
  /* The day-one threshold. Server-authoritative: whether Tex has begun
     lives in the backend, not localStorage. While the status read is in
     flight the surface renders nothing (silence is the resting truth, not
     a spinner), so a returning operator never sees a flash of the door. */
  const ignition = useIgnition();

  /* The estate Tex watches is the one the operator CONNECTED — never an
     implicit default. Nothing is watched until a real directory is connected,
     so no simulated/default backend tenant can ever leak onto the glass;
     silence is the resting truth until then. VITE_TEX_TENANT is a DEV-ONLY
     convenience: it is honoured ONLY under `vite dev` (import.meta.env.DEV), so
     a production build IGNORES it even if the deploy environment sets it. */
  const watchTenant =
    ignition.connectedTenant ||
    (import.meta.env.DEV ? import.meta.env.VITE_TEX_TENANT : null) ||
    null;
  const vigil = useVigil(watchTenant);
  const snapshot = useSystemState(watchTenant);

  /* The real breath. true → Tex is alive on the wire and the surface
     breathes. false → the wire is gone and the breath holds still. */
  const alive = useHeartbeat();

  /* Local aliases for the ignition threshold state. */
  const ignitionReady = ignition.ready;
  const ignitionDoorOpen = ignition.doorOpen;

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

  /* The day-one THRESHOLD is showing — the manifesto door. The first reach here
     WAKES Tex (unlocks audio, starts the manifesto). */
  const onThreshold = ignitionDoorOpen;

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
  /* The id of the held decision Tex has already spoken on arrival, so a NEW
     held decision is voiced once, unprompted, and the same one is never
     re-announced (no nagging, no loop on every vigil frame). Keyed on the same
     dismissKey the card uses (decision id / calibration proposal id). */
  const lastSpokenHeldIdRef = useRef(null);
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

  /* TYPE TO WRITE — the transient typed line. `typed` is null at rest (nothing
     mounted on desktop, latent on touch) and a string while a question forms.
     The ask gesture for typing is inert in exactly the states the voice reach is
     (mirrors beginHold's guard): not before ignition, not over the day-one door,
     not during mapping. */
  const [typed, setTyped] = useState(null);
  const [isCoarsePointer] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches
  );
  const canType = TYPING_ENABLED && ignitionReady && !ignitionDoorOpen && !mapping;
  const inputRef = useRef(null);
  const typingRef = useRef(false); /* live mirror for the document key listener */
  const canTypeRef = useRef(false);
  const composingRef = useRef(false); /* an IME session owns its keys */
  /* GROUNDED COMPLETION — the ghost suffix completes a typed entity fragment
     toward a REAL agent Tex governs (lazy-loaded from the live, signed roster),
     and ONLY when the fragment is unambiguous (Nomon: commit when confident).
     `ghost` is the suggested remainder, shown as a faint native selection. */
  const [ghost, setGhost] = useState("");
  const rosterNamesRef = useRef([]); /* real agent names; the GROUNDED completion vocabulary */
  const rosterLoadedRef = useRef(false);
  /* The general keyboard aid (SymSpell autocorrect + frequency-trie completion),
     lazy-loaded as its own chunk the first time someone types. Grounded agents
     always win; this only fills the gap and corrects ordinary typos. */
  const assistRef = useRef(null); /* the loaded module, or "loading" / null */
  const lastFixRef = useRef(null); /* { from, to, end } — for Backspace-to-revert */
  const noFixRef = useRef(null); /* a just-reverted word, locked from re-correction */
  useEffect(() => {
    typingRef.current = typed !== null;
  }, [typed]);
  useEffect(() => {
    canTypeRef.current = canType;
  }, [canType]);

  /* Pull Tex's real, signed agent names ONCE, the moment a typed question begins
     — never at rest. On any failure the vocabulary stays empty and no ghost ever
     shows: a completion is offered only toward a name Tex can actually prove. */
  const loadRoster = useCallback(() => {
    if (rosterLoadedRef.current) return;
    rosterLoadedRef.current = true;
    getAgentRoster(watchTenant)
      .then((rows) => {
        rosterNamesRef.current = (rows || [])
          .map((r) => r?.name || r?.agent_id || r?.id)
          .filter((n) => typeof n === "string" && n.length > 0);
      })
      .catch(() => {
        /* honest empty — no fabricated vocabulary */
      });
  }, [watchTenant]);

  /* Load the general typing aid (its own chunk) the first time someone types. */
  const loadAssist = useCallback(() => {
    if (assistRef.current) return;
    assistRef.current = "loading";
    import("../../lib/typingAssist")
      .then((m) => m.init().then(() => { assistRef.current = m; }))
      .catch(() => { assistRef.current = null; });
  }, []);

  /* The ghost = the real remainder of the ONE agent name the trailing token
     unambiguously prefixes. Abstains (returns "") on a deletion, a too-short
     fragment, or any ambiguity — so it completes only toward what Tex can prove,
     and only when it is sure. */
  const computeGhost = useCallback((text, isDeletion) => {
    if (isDeletion || !text) return "";
    const m = text.match(/(\S+)$/);
    if (!m) return "";
    const frag = m[1];
    if (frag.length < 2) return "";
    const lower = frag.toLowerCase();
    /* 1. GROUNDED — a real signed agent (always wins; this is the product's
       voice, completing only toward what Tex can prove). */
    const hits = rosterNamesRef.current.filter(
      (n) => n.length > frag.length && n.toLowerCase().startsWith(lower)
    );
    if (hits.length === 1) return hits[0].slice(frag.length);
    /* 2. GENERAL — a common English word (the user's quiet keyboard aid). ONLY
       when no agent could match, so grounded always wins and general never
       guesses a name or fact. Abstains generously (min prefix 3). */
    if (hits.length === 0) {
      const a = assistRef.current;
      if (a && a.complete) {
        const suf = a.complete(frag, 3);
        if (suf) return suf;
      }
    }
    return "";
  }, []);

  /* When a completed line's trailing token IS a real agent, commit it in the
     agent's TRUE casing — so accepting/submitting "claimp"→ "ClaimPulse" sends
     and shows the real entity name, never a lowercased echo. No match → unchanged. */
  const canonicalizeTail = useCallback((text) => {
    const m = text.match(/(\S+)$/);
    if (!m) return text;
    const real = rosterNamesRef.current.find(
      (n) => n.toLowerCase() === m[1].toLowerCase()
    );
    return real ? text.slice(0, text.length - m[1].length) + real : text;
  }, []);

  /* Interaction state. */
  const [holding, setHolding] = useState(false);
  const [thinking, setThinking] = useState(false);
  /* The gate-verification moment. True while /v1/ask is in flight — Tex weighing
     the answer against what it can prove. This is rendered as a DELIBERATE pause
     (a slow, breathing mark), a presence signal that reads as deliberation, not
     lag (CHI 2026). It is the visual twin of the spoken presence ack. */
  const [verifying, setVerifying] = useState(false);
  const [spoken, setSpoken] = useState(null);

  const lineTimer = useRef(null);
  const clearLineTimer = () => {
    if (lineTimer.current) clearTimeout(lineTimer.current);
    lineTimer.current = null;
  };

  /* Word-sync — the index of the word Tex is currently speaking in the manifesto
     line on the glass (-1 = none). Drives the in-step highlight (SpokenLine). */
  const [manifestoWord, setManifestoWord] = useState(-1);
  /* The manifesto is voice-driven: a line dissolves (is-leaving) once Tex has
     finished speaking it and breathed, and Begin appears only once the final line
     has settled (manifestoDone) — never mid-sentence. */
  const [manifestoLeaving, setManifestoLeaving] = useState(false);
  const [manifestoDone, setManifestoDone] = useState(false);
  const manifestoStartedRef = useRef(false);
  /* Word-sync index for the day-one ignition count line the glass holds and
     Tex voices. */
  const [igniteWord, setIgniteWord] = useState(-1);

  /* The interactive answer, surfaced + lit as Tex speaks it, then faded. The one
     transient exception to "answers are spoken, never written" — now PRESENCE-
     aware: it carries the credibility tier the gate sealed, the abstain reason
     when Tex abstains, and any claims you can reach into for their evidence.
     { text, tier, tierReason, claims, proof } | null. */
  const [answer, setAnswer] = useState(null);
  const [answerWord, setAnswerWord] = useState(-1);
  const [answerLeaving, setAnswerLeaving] = useState(false);
  const answerTimer = useRef(null);
  /* Generation token for the spoken answer — bumped each time a new answer is
     spoken, so a superseded answer's (streamed) playback resolution can't fire
     the linger/dissolve onto the answer that replaced it. */
  const answerEpochRef = useRef(0);
  const clearAnswerTimer = () => {
    if (answerTimer.current) clearTimeout(answerTimer.current);
    answerTimer.current = null;
  };
  const clearAnswer = useCallback(() => {
    /* Bump the answer generation so any in-flight texSpeak().then for the answer
       being cleared (a natural dissolve, unmount cleanup, OR a barge-in that
       routes through clearAnswer in beginHold) can no longer re-arm a dissolve
       timer on whatever answer replaces it. */
    answerEpochRef.current += 1;
    clearAnswerTimer();
    setAnswer(null);
    setAnswerWord(-1);
    setAnswerLeaving(false);
  }, []);

  /* Day-one wake — the wake gesture exists ONLY to satisfy browser autoplay: the
     first reach unlocks audio so Tex can speak the manifesto. With the voice muted
     (VOICE_ENABLED false) there is nothing to unlock, so the opener begins on its
     own — awake starts true and "touch to wake" never shows. When the voice is
     restored, awake starts false again and the wake invitation returns, because
     audio still needs that first gesture. */
  const [awake, setAwake] = useState(!VOICE_ENABLED);

  /* Arm (or re-arm) the answer's dissolve: hold it lit for `lingerMs`, then fade
     and clear. Re-armable so reaching for a claim's evidence keeps the answer on
     the glass instead of dissolving out from under the reach. */
  const armAnswerDissolve = useCallback(
    (lingerMs) => {
      clearAnswerTimer();
      answerTimer.current = setTimeout(() => {
        setAnswerLeaving(true);
        clearAnswerTimer();
        answerTimer.current = setTimeout(() => clearAnswer(), ANSWER_FADE_MS);
      }, lingerMs);
    },
    [clearAnswer]
  );

  /* Speak a presence answer in Tex's voice AND surface it on the glass — the
     spoken line, the credibility tier the gate sealed, the abstain reason when it
     abstains, and any claims you can reach into — then linger and dissolve. The
     text and the tier are whatever /v1/ask sealed; this never authors or edits
     them (derivePresence only normalizes the wire). It STREAMS via texSpeak
     (progressive /v1/speak) for the fastest first-sound, so the line shows at full
     ink (no per-word highlight); per-word lighting returns with the streamed-
     timestamp path. An answer carrying a tier/claims earns a longer hold so the
     signal can be read and a claim reached for. */
  const surfaceAnswer = useCallback(
    (presence, lingerOverride) => {
      const text = presence?.spokenText;
      if (!text) return;
      clearLineTimer();
      clearAnswerTimer();
      setSpoken(null);
      setAnswerLeaving(false);
      setAnswerWord(-1);
      setAnswer({
        text,
        tier: presence.tier || null,
        tierReason: presence.tierReason || null,
        claims: presence.claims || [],
        proof: presence.proof || null,
      });
      const lingerMs =
        lingerOverride ??
        (presence.tier || presence.claims?.length || presence.proof
          ? PRESENCE_LINGER_MS
          : ANSWER_LINGER_MS);
      const myAnswer = ++answerEpochRef.current;
      /* Forward the gate's verdict token so the ANSWER is spoken in-tier (rate +
         lead-pause + loudness). Only gate verdicts get a token — the opener /
         "Here." / a falter stay NEUTRAL (a non-verdict line voiced as if it were
         assured/uncertain would be dishonest). */
      texSpeak(text, presence.prosodyToken).then(() => {
        /* Only the CURRENT answer lingers + dissolves — a newer answer (barge-in)
           has already taken the glass, so a stale resolution must not touch it. */
        if (answerEpochRef.current !== myAnswer) return;
        armAnswerDissolve(lingerMs);
      });
    },
    [armAnswerDissolve]
  );

  /* Warm Tex's voice backend the moment the surface loads. A spun-down free-tier
     backend can take tens of seconds to wake; without this the opener's first
     spoken line would race a cold start. Firing the warm-up now means the boot
     overlaps the time the operator spends reading "touch to wake", so by the tap
     the voice is far likelier to be ready. Fire-and-forget; never throws. The
     opener no longer FREEZES on a cold backend regardless (the speech engine is
     timeout-bounded) — this just buys back the sound. */
  useEffect(() => {
    wakeBackend();
  }, []);

  /* ---------------- Faltering speaks first, unprompted ---------------- */
  useEffect(() => {
    if (state !== "faltering") return;
    clearLineTimer();
    setSpoken({ kind: "falter", text: falterLine(snapshot) });
    return clearLineTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /* ---------------- A held decision speaks first, unprompted ----------------
     A HELD decision is one of the only two surfaces allowed to break the
     silence at rest (the other is "Tex is down"). When a NEW one arrives, Tex
     voices its held sentence ONCE, on its own, the instant it lands — the same
     line the card already renders, so the spoken and the written hold agree.

     Said exactly once per held id: lastSpokenHeldIdRef records the dismissKey
     Tex has already announced, so this can never re-fire on a later /v1/vigil
     frame for the same hold (no nag, no loop). A different held id speaks
     fresh. Gated to a settled surface — never over the operator's turn
     (holding), a question round-trip (thinking/verifying), or a dead wire
     (alive). A dismissed hold is already filtered out of liveDecision, so it
     cannot be re-announced. The card itself carries the same sentence, and the
     reach-for-proof path (pullEvidence) is unchanged; voice may be MUTED, in
     which case texSpeak is a no-op and the card alone carries the hold. */
  useEffect(() => {
    if (state !== "held" || !liveDecision || !alive) return;
    if (!dismissKey) return;
    if (holding || thinking || verifying) return;
    if (dismissedRef.current.has(dismissKey)) return;
    if (lastSpokenHeldIdRef.current === dismissKey) return;
    lastSpokenHeldIdRef.current = dismissKey;
    texSpeak(heldSentence(liveDecision));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, dismissKey, alive, holding, thinking, verifying]);

  /* ---------------- The wordless reach: "Here." ---------------- */
  /* You held the surface and said nothing. Not an error — a check-in.
     Tex answers the reach with one word and returns to silence. Only when
     alive; a dead wire cannot speak, and the still breath already answered. */
  const sayHere = useCallback(() => {
    /* A wordless reach no longer answers with a spoken or written "Here." —
       presence is felt through the surface (the breathing deliberation mark),
       not a word or a voice. No-op, so the reach-release branches stay intact. */
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

  /* Reaching for a claim's evidence — the claim→proof link. The claim's sealed
     anchor rises as the one object the glass may hold, and the answer's dissolve
     is re-armed so it stays put while you read the proof. Never fabricates an
     anchor: a claim with no evidence is inert (the button is disabled). */
  const reachEvidence = useCallback(
    (evidence) => {
      if (!evidence?.value) return;
      setAnswerLeaving(false);
      armAnswerDissolve(PRESENCE_LINGER_MS);
      surfaceObject(evidence.value, evidence.kind);
    },
    [armAnswerDissolve, surfaceObject]
  );

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
  const beginMapping = useCallback(async () => {
    openHandledRef.current = true; /* claim the open: no "Here.", no replay */
    stopSpeaking();
    clearLineTimer();
    setSpoken(null);
    setMapDots(1);
    setMapping(true);

    const started = Date.now();
    /* useIgnition.begin() fires POST /v1/surface/discovery/ignite and returns the
       one spoken line — the count of what the scan actually discovered. That
       single spoken sentence IS the whole Begin reveal: the glass speaks the
       count and returns to silence. Tex does not unfurl an inventory list — a
       roster of rows reads as a dashboard, which the surface refuses to be. */
    const line = await ignition.begin();
    const wait = Math.max(0, MAP_MIN_MS - (Date.now() - started));

    clearMappingTimer();
    mappingTimer.current = setTimeout(() => {
      setMapping(false);
      if (line) {
        clearLineTimer();
        setIgniteWord(-1);
        setSpoken({ kind: "ignite", text: line });
        const shownAt = Date.now();
        /* The count is one of the lines the glass HOLDS, so it lights word-by-word
           as Tex voices it (falling back to plain voice if timing is unavailable).
           It clears on the VOICE's clock, not a fixed beat: a fallback safety cap
           is armed now, then onEnd (fired when the voice finishes naturally)
           replaces it with a short read-linger past the final word — so the line
           can never vanish mid-sentence. When the voice is muted/unreachable onEnd
           fires at once, so the read-linger floors at IGNITE_LINE_MS and the line
           still holds a readable beat rather than flashing. */
        lineTimer.current = setTimeout(() => setSpoken(null), IGNITE_LINE_CAP_MS);
        texSpeakTimed(line, {
          onWord: (i) => setIgniteWord(i),
          onEnd: () => {
            const remain = Math.max(
              IGNITE_LINE_LINGER_MS,
              IGNITE_LINE_MS - (Date.now() - shownAt)
            );
            clearLineTimer();
            lineTimer.current = setTimeout(() => setSpoken(null), remain);
          },
        });
      }
    }, wait);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ignition]);

  const deferDiscovery = useCallback(() => {
    openHandledRef.current = true; /* rest in silence; Tex does not nag */
    ignition.dismiss();
  }, [ignition]);

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
  /* The browser's own speech recognizer — the real hold-to-speak. Separate from
     the muted voice gateway (TexListener) so a question can be heard without
     standing up the gateway. */
  const seeListenerRef = useRef(null);

  const beginHold = useCallback(
    (e) => {
      /* Prime Tex's voice on the very first user gesture — browsers block audio
         until then. Safe to call on every press; it no-ops once unlocked, and
         covers the Begin press too (the section's pointerdown fires first). */
      unlockVoice();
      /* Warm the instant presence ack the moment the voice unlocks, so the very
         first real question already has a cached <150ms "I'm on it" to play on
         release. Idempotent + fire-and-forget; degrades to silence if it can't. */
      prewarmPresence();
      /* Day-one wake: the first reach during the opening door wakes Tex's voice
         and starts the manifesto sequence. No mic — just the wake; the manifesto
         begins now that audio is unlocked. */
      if (onThreshold && !awake) {
        setAwake(true);
        return;
      }
      /* Don't start a hold when pressing an actual decision button. */
      if (e && e.target && e.target.closest && e.target.closest("[data-act]")) {
        return;
      }
      /* The ask gesture is inert until the day-one threshold is resolved and
         closed, and while mapping runs. There is nothing sealed to ask about
         before discovery has begun, and holding must not open a mic over the
         greeting or the count. */
      if (!ignitionReady || ignitionDoorOpen || mapping) return;

      clearLineTimer();
      clearObjectTimer();
      setSurfaced(null);
      clearAnswer();
      stopSpeaking();
      setThinking(false);
      setVerifying(false);

      /* Anchor the whole gesture to THIS pointer. The clears above tear down the
         content under the cursor, and without capture the browser fires a stray
         pointercancel (pressed element removed) or pointerleave (cursor slides off
         a child) that ends the hold — the mic closes and the listening orb dies
         after a single throb. Capturing binds every follow-up pointer event to the
         field, so the hold ends only on a real release (pointerup) or true cancel. */
      if (e && e.pointerId != null && e.currentTarget?.setPointerCapture) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore — capture is a robustness boost, not a requirement */
        }
      }
      setHolding(true);

      /* A press is the OPERATOR's turn: Tex yields the floor and listens, it does
         not speak. The `stopSpeaking()` above already barges in on any line in
         flight (ambient utterance, held restate). Tex must NOT announce the held
         decision here — that text already lives on the glass as the held card
         (`.tex-held-sentence` + Approve/Hold/Refuse), so speaking it on every
         press-to-ask is Tex talking over the very turn it just opened. Tex speaks
         again only to ANSWER (surfaceAnswer on release) or, on a wordless reach,
         to pull the proof (pullEvidence). The `is-listening` state on `holding`
         is the only cue the press needs. */

      /* The real hold-to-speak: the browser's OWN speech recognizer hears the
         question. It is the PRIMARY (and today only) capture path. The muted voice
         gateway (TexListener) is stood up ONLY where the browser has no recognizer —
         so we never fire the unprovisioned gateway (a console-spamming /v1/voice/token
         503) or contend for the mic when the browser can already hear. Degrades to
         silence where neither exists (the gesture is still answered with "Here." /
         the held proof below). */
      if (SEE_STT_SUPPORTED) {
        if (seeListenerRef.current) {
          try { seeListenerRef.current.stop(); } catch { /* ignore */ }
        }
        const see = new SeeListener();
        seeListenerRef.current = see;
        see.start().catch(() => {
          seeListenerRef.current = null;
        });
      } else {
        const listener = new TexListener();
        listenerRef.current = listener;
        listener.start().catch(() => {
          listenerRef.current = null;
        });
      }
    },
    [state, liveDecision, snapshot, ignitionReady, ignitionDoorOpen, mapping, awake, onThreshold, clearAnswer]
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
      explainLine(decision.dimension || null, heldSentence(decision), watchTenant)
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
    [surfaceObject, watchTenant]
  );

  const endHold = useCallback(() => {
    if (!holding) return;
    setHolding(false);

    /* The spoken question comes from the browser's own recognizer (the voice
       gateway is muted); fall back to the gateway listener if it somehow opened.
       Whichever resolves a transcript feeds the SAME grounded answer flow. */
    const see = seeListenerRef.current;
    seeListenerRef.current = null;
    const listener = listenerRef.current;
    listenerRef.current = null;
    const capture = see || listener;
    if (see && listener) {
      try { listener.stop(); } catch { /* ignore */ }
    }

    /* Whether this release should be answered with "Here": only a reach made
       in silence, and only while Tex is alive to answer. */
    const reachInSilence = state === "silent" && alive;
    /* A reach made while a decision is held is a request for the proof. */
    const reachInHeld = state === "held" && alive && Boolean(liveDecision);

    /* No recognizer opened (unsupported / denied). The gesture still happened,
       so a silent reach is answered and a held reach pulls the proof. */
    if (!capture) {
      if (reachInHeld) pullEvidence(liveDecision);
      else if (reachInSilence) sayHere();
      return;
    }

    setThinking(true);
    capture
      .stop()
      .then((transcript) => {
        setThinking(false);
        if (!transcript) {
          if (reachInHeld) pullEvidence(liveDecision);
          else if (reachInSilence) sayHere();
          return undefined;
        }
        /* The instant presence beat — fire the content-free ack the moment we
           have a question, BEFORE the grounded round-trip. It plays from the
           pre-warmed cache (<150ms) and is superseded click-free by the answer
           the instant askTex resolves: the gap is now filled, not dead air. The
           gate-verification pause (verifying) is its visual twin — a deliberate
           beat that reads as Tex weighing the answer against what it can prove. */
        playPresenceAck();
        setVerifying(true);
        return askTex(transcript, watchTenant).then((res) => {
          setVerifying(false);
          /* Backend decides, frontend renders: derivePresence only NORMALIZES the
             wire (the presence envelope when present, the AskResponse otherwise).
             The credibility tier it carries is the gate's real verdict, never a
             confidence the UI invented. */
          const presence = derivePresence(res);
          if (presence?.spokenText) {
            /* Meaning is spoken — and now surfaced with its tier and any claims,
               then dissolved (never persisted). If the answer's target is an
               object you must carry away (a hash, an exact name), that handle also
               surfaces, then dissolves. */
            surfaceAnswer(presence);
            if (presence.object?.value) {
              surfaceObject(presence.object.value, presence.object.kind);
            }
          } else if (reachInSilence) {
            sayHere();
          }
        });
      })
      .catch(() => {
        setThinking(false);
        setVerifying(false);
      });
  }, [holding, state, alive, sayHere, surfaceObject, pullEvidence, liveDecision, surfaceAnswer, watchTenant]);

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

  /* ---------------- TYPE TO WRITE — the typed line ----------------
     A printable keystroke conjures the line; submit reuses the grounded answer
     path; the line dissolves voiced-and-gone. Self-contained and flag-gated, so
     the proven voice reach above is untouched even when typing ships. */
  const cancelTyping = useCallback(() => {
    setTyped(null);
    setGhost("");
    typingRef.current = false;
    const el = inputRef.current;
    if (el) {
      try {
        el.blur();
      } catch {
        /* ignore */
      }
    }
  }, []);

  /* Begin a typed line with its first character already in it — we insert the
     char into state directly and never rely on the browser to carry it into the
     newly-focused field (the dropped-first-char race). Focus + caret land after
     the input commits. A typed ask barges in on any ambient line, like a press. */
  const beginTyping = useCallback(
    (firstChar) => {
      loadRoster();
      loadAssist();
      clearAnswer();
      stopSpeaking();
      setTyped(firstChar);
      setGhost(""); /* one char is too short to complete — abstain */
      typingRef.current = true;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        try {
          el.focus();
          const n = el.value.length;
          el.setSelectionRange(n, n);
        } catch {
          /* ignore */
        }
      });
    },
    [clearAnswer, loadRoster, loadAssist]
  );

  /* Submit the typed question — the SAME grounded round-trip the voice reach runs
     (playPresenceAck → /v1/ask → derivePresence → surfaceAnswer), then dissolve.
     The line is read, then cleared immediately: never persisted, never echoed.
     (Duplicates the voice path's ~6-line answer flow on purpose, so the proven
     endHold stays byte-identical while typing is behind a flag; DRY once shipped.) */
  const submitTyped = useCallback(() => {
    /* The full displayed line — the user's text plus any confident ghost they
       left standing — so submitting accepts the completion and asks the real
       grounded question about the real agent. */
    const q = canonicalizeTail((typed ?? "") + ghost).trim();
    cancelTyping();
    if (!q) return;
    playPresenceAck();
    setVerifying(true);
    askTex(q, watchTenant)
      .then((res) => {
        setVerifying(false);
        const presence = derivePresence(res);
        if (presence?.spokenText) {
          surfaceAnswer(presence);
          if (presence.object?.value) {
            surfaceObject(presence.object.value, presence.object.kind);
          }
        }
      })
      .catch(() => setVerifying(false));
  }, [typed, ghost, cancelTyping, watchTenant, surfaceAnswer, surfaceObject, canonicalizeTail]);

  /* The input owns its own keys: stop them reaching the section's voice handler
     (a typed space/Enter must never open the mic). Enter asks; Escape dissolves;
     an in-flight IME composition is left to finish. */
  const onTypedKeyDown = useCallback(
    (e) => {
      e.stopPropagation();
      if (composingRef.current || e.isComposing || e.keyCode === 229) return;
      /* Backspace immediately after an autocorrect UNDOES it (the iOS pattern):
         restore the original word, keep the boundary, and lock that word from
         being re-corrected. Only in the exact window (caret just past the fix). */
      if (e.key === "Backspace" && lastFixRef.current) {
        const lc = lastFixRef.current;
        const el = inputRef.current;
        if (
          el &&
          el.selectionStart === el.selectionEnd &&
          el.selectionStart === lc.end + 1
        ) {
          e.preventDefault();
          const v = el.value;
          const start = lc.end - lc.to.length;
          const reverted = v.slice(0, start) + lc.from + v.slice(lc.end);
          const caret = start + lc.from.length;
          noFixRef.current = lc.from;
          lastFixRef.current = null;
          setTyped(reverted);
          setGhost("");
          requestAnimationFrame(() => {
            const node = inputRef.current;
            if (node) {
              try {
                node.setSelectionRange(caret, caret);
              } catch {
                /* ignore */
              }
            }
          });
          return;
        }
        lastFixRef.current = null;
      } else if (lastFixRef.current) {
        lastFixRef.current = null; /* the revert window is only the immediate next key */
      }
      /* Accept the grounded ghost with one gesture: commit it into the line and
         drop the caret at the end. Reject is just to keep typing (it replaces the
         selected ghost) or Escape. */
      if (ghost && (e.key === "ArrowRight" || e.key === "Tab" || e.key === "End")) {
        e.preventDefault();
        const full = canonicalizeTail((typed ?? "") + ghost);
        setTyped(full);
        setGhost("");
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) {
            try {
              const n = el.value.length;
              el.setSelectionRange(n, n);
            } catch {
              /* ignore */
            }
          }
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        submitTyped();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelTyping();
      }
    },
    [ghost, typed, submitTyped, cancelTyping, canonicalizeTail]
  );

  /* Losing focus with nothing typed dissolves the line back to silence — the
     line exists only while a question is forming. A line with content stays put
     (e.g. the mobile keyboard dismissed) so a half-typed question isn't lost. */
  const onTypedBlur = useCallback(() => {
    if (!typed || !typed.trim()) cancelTyping();
  }, [typed, cancelTyping]);

  /* Every keystroke into the line. Stores the user's text, recomputes the ghost
     (grounded → general), and — when a word boundary was just typed — gently
     autocorrects the word before it. The correction is conservative (the engine
     protects caps/acronyms/real words) and NEVER touches a word that prefixes a
     real agent (a grounded entity must not be "fixed" into English). It is
     reversible: the very next Backspace undoes it (see onTypedKeyDown). */
  const onTypedChange = useCallback(
    (e) => {
      let value = e.target.value;
      const it = (e.nativeEvent && e.nativeEvent.inputType) || "";
      const data = (e.nativeEvent && e.nativeEvent.data) || "";
      const del = it.startsWith("delete");
      let caretFix = null;

      if (
        !del &&
        !composingRef.current &&
        it === "insertText" &&
        data &&
        /[\s.,!?;:]/.test(data)
      ) {
        const caret = e.target.selectionStart; /* just after the boundary char */
        const before = value.slice(0, caret - 1);
        const wm = before.match(/([A-Za-z]+)$/);
        const a = assistRef.current;
        if (wm && a && a.correct) {
          const word = wm[1];
          const start = caret - 1 - word.length;
          const isGrounded = rosterNamesRef.current.some((n) =>
            n.toLowerCase().startsWith(word.toLowerCase())
          );
          if (noFixRef.current === word) {
            noFixRef.current = null; /* respected once, then released */
          } else if (!isGrounded) {
            const fixed = a.correct(word);
            if (fixed && fixed !== word) {
              value = value.slice(0, start) + fixed + value.slice(caret - 1);
              caretFix = caret + (fixed.length - word.length);
              lastFixRef.current = { from: word, to: fixed, end: start + fixed.length };
            }
          }
        }
      } else if (!del) {
        lastFixRef.current = null; /* a non-boundary edit closes the revert window */
      }

      setTyped(value);
      setGhost(composingRef.current ? "" : computeGhost(value, del));

      if (caretFix != null) {
        const c = caretFix;
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) {
            try {
              el.setSelectionRange(c, c);
            } catch {
              /* ignore */
            }
          }
        });
      }
    },
    [computeGhost]
  );

  /* Desktop "just start typing": one document-level keydown listener catches the
     first printable key on a cold surface (nothing is focused at rest). It is the
     ONLY new global handler and it defers entirely once a line is open (the input
     owns keys) or when typing is inert. Guards, in order: typing already open →
     let the field handle it; not allowed yet (pre-ignition / door / mapping) →
     ignore; IME composition → let it own the keystroke; a modifier chord → leave
     shortcuts alone; not a single printable char, or a space → not a line-start
     (space at rest is the keyboard voice reach); focus already in an editable /
     interactive element → don't hijack (preserves AT type-ahead and the held
     card's buttons). Only then does the first letter conjure the line. */
  useEffect(() => {
    if (!TYPING_ENABLED) return undefined;
    const onDocKeyDown = (e) => {
      if (typingRef.current) return;
      if (!canTypeRef.current) return;
      if (e.isComposing || e.keyCode === 229) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.key || e.key.length !== 1 || e.key === " ") return;
      const ae = document.activeElement;
      if (
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable ||
          (ae.closest && ae.closest("[data-act]")))
      ) {
        return;
      }
      e.preventDefault();
      beginTyping(e.key);
    };
    document.addEventListener("keydown", onDocKeyDown);
    return () => document.removeEventListener("keydown", onDocKeyDown);
  }, [beginTyping]);

  /* A voice reach supersedes an open typed line: the instant a press opens the
     mic (holding), any half-formed typed question dissolves, so the two ask
     paths never share the glass. Kept out of beginHold so the proven voice path
     stays untouched; a no-op when typing is off (typed is always null then). */
  useEffect(() => {
    if (holding && typed !== null) cancelTyping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding]);

  /* Render the ghost AS a native selection on the trailing suffix — styled faint
     via .tex-line::selection (no blue highlight). Selecting it natively means
     typing the next char replaces it (type-through) and accept/submit just work,
     with no overlay/mirror to keep aligned on a centered line. */
  useEffect(() => {
    if (!ghost || typed === null) return;
    const el = inputRef.current;
    if (!el) return;
    const start = (typed ?? "").length;
    try {
      el.setSelectionRange(start, start + ghost.length);
    } catch {
      /* ignore */
    }
  }, [ghost, typed]);

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

  /* Tear down any pending timers — and silence Tex — on unmount. */
  useEffect(() => {
    return () => {
      clearLineTimer();
      clearObjectTimer();
      clearMappingTimer();
      clearAnswerTimer();
      stopSpeaking();
      if (seeListenerRef.current) {
        try { seeListenerRef.current.stop(); } catch { /* ignore */ }
        seeListenerRef.current = null;
      }
    };
  }, []);

  /* ---------------- Dev-only render harness ----------------
     The hold→ask flow needs a real mic transcript and a live backend to answer
     /v1/ask, neither of which a headless browser has — so this exposes the EXACT
     presence render path (gate-verification pause → derivePresence → surfaceAnswer)
     under a raw AskResponse / presence envelope, for browser verification only. It
     is gated on import.meta.env.DEV, so a production build statically strips this
     entire block (DEV is false → dead-code-eliminated). It NEVER runs in prod and
     never fabricates an answer the operator sees in the real flow. */
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return;
    window.__texPresence = (raw, { verifyMs = 1100, lingerMs } = {}) => {
      ignition.dismiss(); /* cross the day-one door into the live surface */
      stopSpeaking();
      clearAnswer();
      clearObjectTimer();
      setSurfaced(null);
      setSpoken(null);
      setVerifying(true);
      setTimeout(() => {
        setVerifying(false);
        const presence = derivePresence(raw);
        if (presence?.spokenText) {
          surfaceAnswer(presence, lingerMs);
          if (presence.object?.value) {
            surfaceObject(presence.object.value, presence.object.kind);
          }
        }
      }, verifyMs);
    };
    /* Hold just the deliberation pause open, for screenshotting that beat. */
    window.__texVerifying = (on = true) => setVerifying(Boolean(on));
    return () => {
      try {
        delete window.__texPresence;
        delete window.__texVerifying;
      } catch { /* ignore */ }
    };
  }, [ignition, surfaceAnswer, surfaceObject, clearAnswer]);

  /* DEV-ONLY TYPING BENCHMARK — measures the grounded completion against the
     field's metric (KSPC, Soukoreff & MacKenzie) over Tex's REAL signed roster,
     vs the full-typing baseline (KSPC=1.0). The savings are deterministic given
     the roster: for each agent the completion needs the chars up to its unique
     prefix plus ONE accept, so keystrokes = min(p+1, L). It also samples the
     keystroke→paint frame budget (Nielsen's 100ms instantaneity threshold).
     Gated on import.meta.env.DEV so prod statically strips it; it reads the live
     roster and the SAME unique-prefix rule the real completion uses, so the
     number is the real mechanism's, not a fabrication. */
  useEffect(() => {
    if (!import.meta.env.DEV || !TYPING_ENABLED || typeof window === "undefined")
      return undefined;
    const minUniquePrefix = (name, names) => {
      const L = name.length;
      for (let p = 2; p < L; p += 1) {
        const pre = name.slice(0, p).toLowerCase();
        if (names.filter((n) => n.toLowerCase().startsWith(pre)).length === 1) return p;
      }
      return L; /* never unique before the full name → no completion savings */
    };
    window.__texTypingBench = async () => {
      const rows = await getAgentRoster(watchTenant);
      const names = (rows || [])
        .map((r) => r?.name || r?.agent_id || r?.id)
        .filter((n) => typeof n === "string" && n.length > 1);
      const per = names.map((name) => {
        const L = name.length;
        const p = minUniquePrefix(name, names);
        const keys = p < L ? p + 1 : L; /* p chars + 1 accept, or type it all */
        return { name, len: L, uniquePrefix: p, keystrokes: keys, kspc: keys / L };
      });
      const avgKspc = per.reduce((s, r) => s + r.kspc, 0) / (per.length || 1);
      /* keystroke→paint sample: time a real value-set + input → next paint. */
      const el = inputRef.current;
      let paintMs = null;
      if (el) {
        const t0 = performance.now();
        await new Promise((res) => requestAnimationFrame(() => res()));
        paintMs = performance.now() - t0;
      }
      const result = {
        metric: "KSPC (Soukoreff & MacKenzie) — grounded completion vs full-typing baseline 1.0",
        rosterSize: names.length,
        avgKspc: Number(avgKspc.toFixed(4)),
        baselineKspc: 1.0,
        avgKeystrokeSavingPct: Number(((1 - avgKspc) * 100).toFixed(1)),
        framePaintMs: paintMs == null ? null : Number(paintMs.toFixed(2)),
        nielsenInstantThresholdMs: 100,
        per,
      };
      // eslint-disable-next-line no-console
      console.log("[texTypingBench]", JSON.stringify(result));
      return result;
    };
    return () => {
      try {
        delete window.__texTypingBench;
      } catch {
        /* ignore */
      }
    };
  }, [watchTenant]);

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
    : ignitionReady && ignitionDoorOpen
    ? "I am Tex. Nothing happens without me. Press Begin."
    : mapping
    ? "Tex is mapping the estate."
    : state === "held"
    ? "Tex is holding a decision for you."
    : state === "faltering"
    ? "Tex's integrity has failed."
    : TYPING_ENABLED
    ? /* Both ask paths are advertised to assistive tech — the typed path is the
         dead-mic / can't-speak lifeline, so a screen-reader user must learn it. */
      "Tex, watching. Hold to speak. Type to write."
    : "Tex, watching. Press and hold anywhere to speak.";

  const decision = liveDecision;

  /* The day-one door owns the surface until it is crossed — the session-scoped
     threshold, deferring to a faltering chain (you don't greet over a broken
     witness) and yielding to the mapping state the instant Begin is pressed. */
  const doorOpen =
    ignition.ready &&
    ignition.doorOpen &&
    state !== "faltering" &&
    !mapping;

  /* The open, in Tex's voice — VOICE-DRIVEN, played strictly one line at a time.
     Once awake, the whole arc runs through a single speech sequence: each line
     mounts (onLineStart), lights word-by-word as Tex voices it (onWord), then —
     only after the voice ends and breathes — dissolves (onLineLeave) and yields
     to the next. The audio clock advances the arc; there are no fixed beats, so
     the glass can never spill three lines at once or drift from what is heard.
     The final line arrives and stays; Begin appears only when it has settled
     (onDone). Falls back inside the engine to plain voice (no highlight), and —
     if no audio is reachable at all — paces on MANIFESTO_BEATS as the silence
     floor so the arc still reads. Started once per opening (a ref guard) so React
     18 StrictMode's double-invoke can't double-run it; a barge-in (a fresh speak)
     would supersede it cleanly regardless. */
  useEffect(() => {
    if (!doorOpen) {
      manifestoStartedRef.current = false;
      setManifestoStep(0);
      setManifestoWord(-1);
      setManifestoLeaving(false);
      setManifestoDone(false);
      return;
    }
    if (!awake) return; /* the arc waits for the wake gesture */
    if (manifestoStartedRef.current) return;
    manifestoStartedRef.current = true;
    texSpeakSequence(MANIFESTO, {
      silenceHold: [...MANIFESTO_BEATS, MANIFESTO_FINAL_HOLD_MS],
      breathMs: MANIFESTO_BREATH_MS,
      leaveMs: MANIFESTO_LEAVE_MS,
      onLineStart: (i) => {
        setManifestoStep(i);
        setManifestoWord(-1);
        setManifestoLeaving(false);
      },
      onWord: (i) => setManifestoWord(i),
      onLineLeave: () => setManifestoLeaving(true),
      onDone: () => setManifestoDone(true),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doorOpen, awake]);

  return (
    <section
      className={fieldClass}
      aria-label={ariaState}
      tabIndex={0}
      onPointerDown={beginHold}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      {/* The open-mic radar — a soft breathing core (the field's ::before) plus
          two staggered rings on this node, so the pulse never gaps. Purely
          decorative; shown only while .is-listening. */}
      <span className="tex-listen" aria-hidden="true" />
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

      {/* The day-one threshold — an arc shown once, then gone: the declaration,
          the one claim, the handover. The final line stays and shows a single
          act, Begin (no opt-out). Each cycling line's fade is timed to its own
          beat. The act carries data-act so a press on it never opens the mic. */}
      {doorOpen && (
        <div className="tex-door" role="group" aria-label="Tex">
          {!awake ? (
            /* The wake — a quiet invitation. The first reach (anywhere) unlocks
               audio and starts the manifesto in Tex's own voice. */
            <p className="tex-door-sentence tex-door-wake">touch to wake Tex</p>
          ) : (
            /* The current beat. It RISES in on mount (keyed by step), holds while
               Tex speaks it — word-synced, for as long as the voice needs — then
               DISSOLVES (is-leaving) when the sequence advances. The final line
               (--hold) only arrives; it never leaves. The hold is no longer a
               fixed CSS duration, so a line can never fade out mid-word. */
            <p
              key={manifestoStep}
              className={
                "tex-door-sentence tex-door-line" +
                (manifestoStep >= MANIFESTO.length - 1 ? " tex-door-line--hold" : "") +
                (manifestoLeaving ? " is-leaving" : "")
              }
            >
              <SpokenLine text={MANIFESTO[manifestoStep]} active={manifestoWord} />
            </p>
          )}
          {/* The act slot is RESERVED the moment the manifesto starts (awake), so
              revealing Begin never reflows the line above it — the line never
              jumps. Begin stays hidden + inert until the final line has landed
              (manifestoDone), then fades in on its own. */}
          {awake && (
            <div
              className={
                "tex-acts tex-door-acts" + (manifestoDone ? " is-revealed" : "")
              }
            >
              <button
                type="button"
                data-act="begin"
                className="tex-act tex-act--approve"
                disabled={!manifestoDone || ignition.igniting}
                aria-hidden={manifestoDone ? undefined : true}
                onClick={beginMapping}
              >
                Begin
              </button>
            </div>
          )}
        </div>
      )}

      {/* The mapping working state. Tex is already awake, so "mapping" is it
          showing its work: the field holds with a growing ellipsis while real
          discovery runs, then settles into the count. */}
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

      {/* The held decision — Tex's voice, the facts, the resolved acts. While a
          spoken answer is overlaying the glass (a reach answered while held), the
          card RECEDES so the answer reads alone, then returns when it dissolves —
          never the two sentences mushed on top of each other. It also recedes
          during the gate-verification pause, so the deliberation mark reads alone
          before the answer arrives. */}
      {!doorOpen && !mapping && state === "held" && decision && !sealed && (
        <div
          className={`tex-held${
            answer || verifying || typed !== null ? " is-receded" : ""
          }`}
        >
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

      {/* The gate-verification pause — the deliberate beat between the question
          and the answer, rendered as a presence signal (not a spinner). A single
          ink mark breathes on a slow, even rhythm: Tex weighing the answer against
          what it can prove. It reads as deliberation, not lag (CHI 2026), and it
          is the visual twin of the spoken presence ack. It clears the instant the
          answer (or "Here.") takes the glass. */}
      {!doorOpen && !mapping && !sealed && !answer && (verifying || thinking) && (
        <div
          className="tex-deliberation"
          role="status"
          aria-live="polite"
          aria-label="Tex is checking what it can prove"
        >
          <DeliberationMark />
        </div>
      )}

      {/* The voice — Tex speaks; the glass stays clean. The only spoken lines that
          touch the paper are presence ("Here."), the ignition count, and the
          faltering warning — states Tex is IN, not answers to a question. The
          interactive answer lives in its own presence block below. */}
      {!doorOpen && !mapping && !answer && state !== "held" && !sealed && (
        <div className="tex-voice" aria-live="polite">
          {spoken &&
            (spoken.kind === "here" ||
              spoken.kind === "falter" ||
              spoken.kind === "ignite") && (
              <p
                className={`tex-voice-line tex-voice-line--${spoken.kind}`}
                key={spoken.text}
              >
                {spoken.kind === "ignite" ? (
                  <SpokenLine text={spoken.text} active={igniteWord} />
                ) : (
                  spoken.text
                )}
              </p>
            )}
        </div>
      )}

      {/* The presence answer — the one transient exception to "answers are spoken,
          never written". Tex's grounded line, lit as it is voiced, carrying the
          credibility TIER the gate sealed (a visible, honest signal), the abstain
          reason when it abstains, and any claims you can reach into for their
          evidence. It rises, holds long enough to be read and reached for, then
          dissolves — voiced-and-gone, never persisted. */}
      {!doorOpen && !mapping && !sealed && answer && (
        <div className="tex-presence" aria-live="polite">
          <p
            className={`tex-presence-line${answerLeaving ? " is-leaving" : ""}`}
          >
            <SpokenLine text={answer.text} active={answerWord} />
          </p>

          {/* The credibility tier — perceived credibility derived from the gate's
              REAL verdict, never an invented confidence. Ink only (the surface
              keeps color for the faltering breath alone): the tiers read apart by
              their mark and weight, not by a green/amber/red ramp. */}
          {answer.tier && (
            <p
              className={`tex-tier tex-tier--${answer.tier.toLowerCase()}${
                answerLeaving ? " is-leaving" : ""
              }`}
              aria-label={`Credibility: ${TIER_LABEL[answer.tier]} — ${
                answer.tierReason || TIER_GLOSS[answer.tier]
              }`}
            >
              <span className="tex-tier-mark" aria-hidden="true" />
              <span className="tex-tier-label">{TIER_LABEL[answer.tier]}</span>
              <span className="tex-tier-gloss">
                {answer.tier === TIER.ABSTAIN
                  ? answer.tierReason || TIER_GLOSS[answer.tier]
                  : TIER_GLOSS[answer.tier]}
              </span>
            </p>
          )}

          {/* Claims → evidence. Each claim is a reach: pressing it (data-act, so
              it never opens the mic) rises that claim's sealed anchor as the one
              object the glass may hold. A claim with no evidence is inert. When
              there are no structured claims yet (today's wire), a single "show the
              proof" reach surfaces the answer's anchor. */}
          {(answer.claims?.length > 0 || answer.proof) && (
            <div
              className={`tex-evidence${answerLeaving ? " is-leaving" : ""}`}
            >
              {answer.claims?.length > 0 ? (
                answer.claims.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    data-act="evidence"
                    className="tex-claim"
                    disabled={!c.evidence}
                    aria-label={
                      c.evidence
                        ? `Show the evidence for: ${claimLabel(c)}`
                        : claimLabel(c)
                    }
                    onClick={() => reachEvidence(c.evidence)}
                  >
                    <span className="tex-claim-text">{claimLabel(c)}</span>
                    {c.evidence && (
                      <span className="tex-claim-cue" aria-hidden="true">
                        proof
                      </span>
                    )}
                  </button>
                ))
              ) : (
                <button
                  type="button"
                  data-act="evidence"
                  className="tex-claim tex-claim--proof"
                  aria-label="Show the proof behind this answer"
                  onClick={() => reachEvidence(answer.proof)}
                >
                  <span className="tex-claim-cue" aria-hidden="true">
                    show the proof
                  </span>
                </button>
              )}
            </div>
          )}

          {/* The reached handle — the anchor a claim links to, risen as the one
              object the glass may hold, here flowing under the answer rather than
              centering on the whole field. Dissolves once taken. */}
          {surfaced && (
            <div
              className="tex-object tex-object--in-presence"
              role="status"
              aria-live="polite"
            >
              <span className="tex-object-value" key={surfaced.value}>
                {surfaced.value}
              </span>
            </div>
          )}
        </div>
      )}

      {/* TYPE TO WRITE — the transient typed line. The question forming, in the
          SAME voice register Tex answers in (the display serif), centered. It is
          a real <input> so it inherits native caret, selection, IME, and mobile
          predictive text; styled to a bare line — no box, no border, no send
          button. On a touch device the input stays MOUNTED but latent (collapsed,
          inert, off the a11y tree) so the resident glyph can focus it
          synchronously inside the tap — the only way iOS raises the keyboard. On
          desktop nothing is mounted until the first keystroke. It is voiced-and-
          gone: cleared on submit, never persisted. data-act keeps a press on it
          from opening the mic. */}
      {TYPING_ENABLED && !doorOpen && !mapping && (typed !== null || isCoarsePointer) && (
        <div className="tex-line-slot">
          <input
            ref={inputRef}
            data-act="write"
            className={"tex-line" + (typed === null ? " tex-line--latent" : "")}
            value={(typed ?? "") + ghost}
            onChange={onTypedChange}
            onKeyDown={onTypedKeyDown}
            onKeyUp={(e) => e.stopPropagation()}
            onBlur={onTypedBlur}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            inputMode="text"
            enterKeyHint="send"
            autoCapitalize="sentences"
            autoCorrect="on"
            autoComplete="off"
            spellCheck
            aria-label="Type your question to Tex"
            aria-hidden={typed === null ? true : undefined}
            tabIndex={typed === null ? -1 : 0}
          />
        </div>
      )}

      {/* The single resident concession to a literal empty-at-rest surface, on
          touch only: one tiny, static, low-contrast mark the operator taps to
          raise the keyboard. data-act so the tap focuses the line instead of
          opening the mic; the focus is synchronous inside the tap (iOS). */}
      {TYPING_ENABLED &&
        !doorOpen &&
        !mapping &&
        isCoarsePointer &&
        canType &&
        typed === null && (
          <button
            type="button"
            data-act="write"
            className="tex-write-glyph"
            aria-label="Type a question to Tex"
            onClick={(e) => {
              e.stopPropagation();
              loadRoster();
              loadAssist();
              const el = inputRef.current;
              if (el) {
                try {
                  /* Un-hide synchronously BEFORE focus so focus never lands on an
                     aria-hidden node; React reconciles to the same state this tick. */
                  el.removeAttribute("aria-hidden");
                  el.tabIndex = 0;
                  el.focus();
                } catch {
                  /* ignore */
                }
              }
              setTyped("");
            }}
          />
        )}

      {/* The object — the one thing the screen is ever allowed to hold: a
          handle you grab and walk away with. It rises alone, monospace,
          centered, only because you reached for it, and dissolves the moment
          it has been taken. When an answer is on the glass the handle rises
          inside that presence block instead (above), so it never double-renders. */}
      {!doorOpen && !mapping && state !== "held" && !answer && !sealed && surfaced && (
        <div className="tex-object" role="status" aria-live="polite">
          <span className="tex-object-value" key={surfaced.value}>
            {surfaced.value}
          </span>
        </div>
      )}
    </section>
  );
}
