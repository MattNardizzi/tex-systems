import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import "./Vigil.css";
import { useVigil } from "../../hooks/useVigil";
import { useSystemState } from "../../hooks/useSystemState";
import { useHeartbeat } from "../../hooks/useHeartbeat";
import { useIgnition } from "../../hooks/useIgnition";
import { askTex, sealDecision, explainLine, approveProposal, rejectProposal, wakeBackend, getAgentRoster, listHeldDecisions } from "../../lib/texApi";
import {
  TexListener,
  texSpeak,
  texSpeakTimed,
  texSpeakSynced,
  texSpeakSequence,
  stopSpeaking,
  isSpeaking,
  unlockVoice,
  prewarmPresence,
  playPresenceAck,
  prewarmSpeak,
  VOICE_ENABLED,
} from "../../lib/texVoiceClient";
import SpokenLine from "./SpokenLine";
import SpanAnswer from "./SpanAnswer";
import { askAnswer, isRouteAbsent } from "../../lib/answers";
import MappingMark from "./MappingMark";
import SealAnchor, {
  ScrambleSeal,
  SEAL_ANCHOR_RE,
  SEALED_NUMBER_RE,
} from "./SealAnchor";
import { SeeListener, SEE_STT_SUPPORTED } from "../../lib/seeListener";
import { completeAsk } from "../../lib/askTemplates";
import {
  derivePresence,
  claimLabel,
  TIER,
  TIER_LABEL,
  TIER_GLOSS,
} from "../../lib/presence";

/* ------------------------------------------------------------------ */
/* Interactive-hit guard — what makes every act un-losable.             */
/* ------------------------------------------------------------------ */
/* The whole product is ONE pointerdown target: the field's beginHold. A press
   on empty paper opens the ask-mic; a press ANYWHERE — including on a proof
   pill or a decision act — used to run beginHold's teardown FIRST (it clears the
   answer, the seal, the reached object) and only THEN let the control's own
   click fire, against a glass that had already dissolved. That is exactly how a
   click on "show the proof" quietly ate the whole answer and fell back to the
   surface beneath.

   hitsInteractive is the global fix. beginHold consults it and returns BEFORE it
   clears anything, so a press that lands on any control is that control's press —
   never the mic, never a surface teardown. It reads the event's composedPath (the
   authoritative, retarget-proof list of every node the press passed through,
   target first), falling back to a target.closest() walk where composedPath is
   unavailable. Any control added later inherits the guard for free: make it a
   native button / a / input, or mark it [data-act] / [role=button], and it is
   safe with no per-button plumbing. (Individual buttons need no stopPropagation;
   this handler-level guard is the belt, not the buttons.) */
const INTERACTIVE_HIT =
  "[data-act],[role=button],[role=link],[role=menuitem],button,a[href],input,textarea,select,label";
function hitsInteractive(e) {
  if (!e) return false; /* the keyboard reach carries no event — always allowed */
  const path = typeof e.composedPath === "function" ? e.composedPath() : null;
  if (path && path.length) {
    for (const node of path) {
      if (node === document || node === window) break;
      if (
        node &&
        node.nodeType === 1 &&
        typeof node.matches === "function" &&
        node.matches(INTERACTIVE_HIT)
      ) {
        return true;
      }
    }
    return false;
  }
  /* No composedPath (older engine): walk up from the event target. */
  const t = e.target;
  return !!(t && typeof t.closest === "function" && t.closest(INTERACTIVE_HIT));
}

/* ------------------------------------------------------------------ */
/* The speculative ask (the precog pattern). A partial transcript that  */
/* has held STABLE this long while the mic is still held is worth       */
/* betting on: /v1/ask fires EARLY, so the sealed answer is often       */
/* already back the instant the release finalizes the same question —  */
/* the single biggest release-to-answer latency lever a grounded        */
/* cascade has. Safe by construction: asks are read-only, so a missed   */
/* bet costs one wasted lookup and is simply abandoned.                 */
/* ------------------------------------------------------------------ */
const SPECULATE_STABLE_MS = 600;

/* Whether the release redeemed the bet: the backend answers the WORDS, so the
   final transcript matches the speculation iff it normalizes identically —
   casing/punctuation jitter between interim and final must not void it. */
const normalizeAsk = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/* ------------------------------------------------------------------ */
/* One material (Five Futures #2): the surface MORPHS between its      */
/* macro states via the View Transitions API instead of swapping them. */
/* Reserved for TEX-driven changes — the door yielding to Mapping, the */
/* count arriving, the seal taking and leaving the glass, the answer   */
/* replacing the deliberation mark. The operator's own press is NEVER  */
/* wrapped: gesture feedback must land within a frame, not wait on a   */
/* snapshot. Falls back to an instant apply when the API is missing,   */
/* motion is reduced, or the tab is hidden (an animation nobody sees   */
/* would only delay the truth). Timing lives in index.css on the law's */
/* own ladder: new state in at 240ms, old state out one rung faster.   */
/* ------------------------------------------------------------------ */
let morphInFlight = false;
let morphInFlightFinished = null; /* the running transition's vt.finished */
function morphSurface(apply) {
  if (
    typeof document === "undefined" ||
    !document.startViewTransition ||
    document.hidden ||
    morphInFlight ||
    (typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  ) {
    /* morphInFlight: a second morph landing inside a running transition's
       window would SKIP the running one (a visible pop) and immediately pay a
       fresh full-document double snapshot + flushSync — the ask path races
       exactly this way (the answer's morph vs the held-rows fetch resolving
       under 320ms). The truth still lands, instantly, inside the live new
       view the running transition is already animating; only the second
       crossfade is declined. */
    apply();
    return;
  }
  morphInFlight = true;
  const vt = document.startViewTransition(() => {
    flushSync(apply);
  });
  morphInFlightFinished = vt.finished.catch(() => {});
  vt.finished
    .catch(() => {})
    .finally(() => {
      morphInFlight = false;
      morphInFlightFinished = null;
    });
}

/* Held rows are DEPTH under a standing answer, and the answer's own morph is
   already running when the rows resolve (the ask path races them under 320ms).
   Surfacing them mid-morph tears them into the running crossfade; landing them
   instantly (morphSurface's decline path) pops them in with no fade. So a held-
   row surfacing WAITS for the in-flight morph to finish, then morphs in on its
   own — the rows settle after the answer, never into it. With no morph running
   it is just morphSurface. */
function morphHeldRows(apply) {
  if (morphInFlight && morphInFlightFinished) {
    morphInFlightFinished.then(() => morphSurface(apply));
    return;
  }
  morphSurface(apply);
}

/* ------------------------------------------------------------------ */
/* The conversation trail. A turn does not vanish when the next one     */
/* takes the surface — it RECEDES: smaller, fainter, above the living   */
/* answer, so a follow-up can be asked about words still on the glass.  */
/* "Refresh" (spoken or typed) is the clean slate: trail, answer, and    */
/* follow-up context all clear, and the next question starts a topic.   */
/* ------------------------------------------------------------------ */
const TRAIL_MAX = 4; /* prior turns kept on the glass; older ones let go */

/* One standard beat (--tex-t3) the retiring answer fades on its is-leaving path
   before it clears — the same window a fast re-ask must beat to keep its answer. */
const ANSWER_LEAVE_MS = 240;

/* The PENDING word index: the answer has mounted but the voice has not begun,
   so SpokenLine holds every word faint (word 0 included). The line then
   brightens strictly forward as the voice reaches each word — never the
   bright-then-dim reverse ink of mounting at full ink and dimming the tail the
   instant word 0 lights. (SpokenLine treats any value <= -2 as pending.) */
const WORD_PENDING = -2;

/* Return to silence. When nothing is asked of Tex and no hand is on the glass
   for this long, the surface dissolves back to empty white — the resting state
   the whole product is built around. It is the PASSIVE twin of Escape: the same
   clean slate (refreshSurface), and the same hard rule — it NEVER clears a
   decision waiting for a human seal (see `deciding`), never interrupts the
   day-one arc, and never cuts across Tex mid-answer or a hand mid-hold. Silence
   is the default; this is only how the surface finds its way back to it. */
const IDLE_BLANK_MS = 10000;

/* The at-rest whisper. After the surface has sat truly silent and untouched
   (no held card, no answer, no seal, the day-one door long finished) for this
   long, ONE faint gesture-hint fades in — the only resident tell that the glass
   can be reached. It is the quietest mark in the system: uppercase, widely
   tracked, ink-faint, and STATIC. It dissolves a rung faster on any activity.
   Deliberately longer than a passing glance so it never nags a working operator. */
const REST_HINT_MS = 12000;

/* The clean-slate verbs — the ONE ask the surface answers itself, never
   the backend. Matched on the normalized whole line, so "Refresh." and
   "refresh" both land and "refresh the roster" still reaches Tex. */
const REFRESH_COMMANDS = new Set([
  "refresh",
  "clear",
  "reset",
  "start over",
  "start fresh",
  "new topic",
  "clear the screen",
  "wipe the screen",
]);
const isRefreshCommand = (s) => REFRESH_COMMANDS.has(normalizeAsk(s));

/* A turn that is ABOUT held decisions: the rows behind the sentence should
   rise with their acts. Tested against the QUESTION (either ask path) and,
   as a net, the answer's own canonical phrasing ("N held decisions ..."). */
const HELD_ASK_RE = /\bheld\b|\bholds?\b|\bholding\b/i;
const HELD_ANSWER_RE = /\bheld\b/i;

/* A SPAN answer that is about the held queue — read from the answer's own
   provenance, never re-guessed from prose: an exhibit whose query filtered
   the ABSTAIN verdict (HELD normalizes to ABSTAIN in the decision store) is
   a held count/list, and its is_zero flag discloses — in provenance, where
   no quantity can leak — whether there is anything to resolve. An empty
   queue offers no way in: an act over nothing would be a lie. When the
   pipeline answered a held-phrased question WITHOUT a verdict-scoped exhibit
   (an abstain), the ask regex still opens the door — the fetch behind the
   act surfaces only rows that truly exist, so a pressed act never invents. */
const spanAnswerHeldness = (res, question) => {
  const exhibits = Array.isArray(res?.exhibits) ? res.exhibits : [];
  const heldExhibit = exhibits.find((ex) => ex?.query?.verdict === "ABSTAIN");
  if (heldExhibit) return !heldExhibit.query.is_zero;
  return HELD_ASK_RE.test(question || "");
};

/* ------------------------------------------------------------------ */
/* The act walks EXACTLY what was spoken. When a span answer is about   */
/* the holds waiting on the operator, the backend returns the very rows */
/* it voiced as an exhibit whose query.tool === "list_held_waiting" —   */
/* rows [{ decision_id, agent, action_type, content_excerpt, at }]. The */
/* sibling count_held_waiting tool answers the count questions and      */
/* carries no rows. Reading the queue from the answer's OWN provenance   */
/* is what lets the SHOW THE HELD DECISIONS act surface precisely the    */
/* holds the sentence just named, never a second source (the in-memory   */
/* sink) that can disagree. The rows are mapped into the SAME shape       */
/* HeldRowsList already walks (the GET /held row), so the one-at-a-time   */
/* presentation and the existing seal (resolveHeldRow → POST /seal) are   */
/* reused wholesale — never a forked component or a new empty-state.      */
/* ------------------------------------------------------------------ */

/* The exhibit that carries the spoken holds, if this answer has one. */
const listHeldWaitingExhibit = (res) => {
  const exhibits = Array.isArray(res?.exhibits) ? res.exhibits : [];
  return exhibits.find((ex) => ex?.query?.tool === "list_held_waiting") || null;
};

/* A row's timestamp → millis, for ordering newest-first. An ISO string or an
   epoch number; anything unparseable sorts oldest (0). */
const heldWaitingRowMs = (at) => {
  if (at == null) return 0;
  const n = typeof at === "number" ? at : Date.parse(at);
  return Number.isNaN(n) ? 0 : n;
};

/* One spoken list_held_waiting row → the row shape HeldRowsList consumes:
   the decision id it seals, WHO (detail.agent_name, with agent_id as the
   label's own fallback) and WHAT (detail.content_excerpt) for the who/what
   layout, the raised time (raised_at), and — for a row whose ask text is
   absent — action_type carried as `kind` so heldRowLine renders the existing
   "Held: <action>" fallback rather than a bare stand-in. */
const mapHeldWaitingRow = (row) => {
  const agent =
    typeof row?.agent === "string" && row.agent.trim() ? row.agent.trim() : null;
  const excerpt =
    typeof row?.content_excerpt === "string" && row.content_excerpt.trim()
      ? row.content_excerpt.trim()
      : null;
  const action =
    typeof row?.action_type === "string" && row.action_type.trim()
      ? row.action_type.trim()
      : null;
  return {
    decision_id: row?.decision_id,
    agent_id: agent,
    detail: { agent_name: agent, content_excerpt: excerpt, action_type: action },
    kind: action,
    raised_at: row?.at ?? null,
  };
};

/* The spoken holds this answer carries, mapped and ordered newest-first (the
   walker steps the array in order, so index 0 is the newest). Only rows that
   carry a decision_id — a row with nothing to seal is not a resolvable hold, so
   it never enters the walk. Empty for any answer WITHOUT a list_held_waiting
   exhibit (old answers, count-only answers, sink-sourced flows), which leaves
   every one of those paths on exactly today's behavior. */
const spanAnswerHeldWaiting = (res) => {
  const ex = listHeldWaitingExhibit(res);
  const rows = Array.isArray(ex?.rows) ? ex.rows : [];
  return rows
    .filter((r) => r && r.decision_id)
    .map(mapHeldWaitingRow)
    .sort((a, b) => heldWaitingRowMs(b.raised_at) - heldWaitingRowMs(a.raised_at));
};

/* One quiet line per held row (GET /v1/surface/discovery/held shape):
   what was held, in the row's own words when it has any. */
const heldRowLine = (row) => {
  const note = typeof row?.note === "string" && row.note.trim() ? row.note.trim() : null;
  if (note) return note;
  const kind = typeof row?.kind === "string" && row.kind.trim() ? row.kind.trim() : null;
  return kind ? `Held: ${kind.replace(/[_-]+/g, " ")}` : "A decision is held.";
};

/* The row's provenance, in the id register: who raised it, when. */
const heldRowMeta = (row) => {
  const parts = [];
  const agent = row?.detail?.agent_name || row?.agent_id || null;
  if (agent) parts.push(String(agent).length > 24 ? `${String(agent).slice(0, 24)}…` : String(agent));
  if (row?.raised_at) {
    const t = new Date(row.raised_at);
    if (!Number.isNaN(t.getTime())) parts.push(t.toLocaleTimeString());
  }
  return parts.join("  ·  ") || null;
};

/* The new agent_name field on a row — the ONLY WHO that flips a row into the
   who/what layout. The pre-existing agent_id is NOT a trigger (nearly every
   legacy row carries one; triggering on it would flip them all), it only serves
   as a display fallback for the label once the row is already who/what. */
const heldRowAgentName = (row) => {
  const n = row?.detail?.agent_name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
};

/* WHO on a held row — the agent as the row's chrome label (uppercased in CSS).
   Prefers the new agent_name, falls back to the row's agent_id; truncated so a
   long principal never blows the label. */
const heldRowAgentLabel = (row) => {
  const name = heldRowAgentName(row) || row?.agent_id || null;
  if (typeof name !== "string" || !name.trim()) return null;
  const t = name.trim();
  return t.length > 32 ? `${t.slice(0, 32)}…` : t;
};

/* WHAT on a held row — the agent's actual ask (the new content_excerpt), shown as
   one truncated line. Absent → the row keeps its own note/kind line. */
const heldRowExcerpt = (row) => {
  const ex = row?.detail?.content_excerpt;
  return typeof ex === "string" && ex.trim() ? ex.trim() : null;
};

/* Just the time for a row whose agent has been promoted to its own label. */
const heldRowTime = (row) => {
  if (!row?.raised_at) return null;
  const t = new Date(row.raised_at);
  return Number.isNaN(t.getTime()) ? null : t.toLocaleTimeString();
};

/* The seal screen: how long a resolved decision rests alone on the glass —
   the verdict line and its sealed anchor — before the queue morphs to the next.
   The walk swaps the anchor in STATICALLY (the scramble-lock hero is reserved for
   the dedicated seal surface), so this is a READ beat: long enough to register the
   number that just landed and hold, not the unplayed scramble timeline. */
const HELD_SEAL_BEAT_MS = 1500;
/* Keep-holding seals nothing to a verdict, so there is no number to land — the
   line alone rests a shorter beat before the next decision. */
const HELD_HOLD_BEAT_MS = 1300;
/* The seal screen shows the computing scramble (the mapping mark) for as long as
   the wire takes to hand back the real anchor — there is no fallback number and
   no timeout that invents one. A slow /seal simply keeps computing; a silent one
   stays computing rather than fabricate a seal the evidence chain never recorded. */

/* The held queue — ONE resolvable decision on the glass at a time. The operator
   resolves the current one (Approve / Keep holding / Refuse → POST /seal); its
   seal lands and rests a beat, then the surface MORPHS to the next held
   decision, and so on until the last — which rests on its seal, the natural
   finish. Only rows carrying a decision_id are walked: a presence-origin hold
   with nothing to seal is not a decision the operator can resolve, so it never
   enters the queue (and can never strand the walk on an unpressable card).
   Progress ("2 / 5") tells the operator how far through they are. The seal
   screen shows the computing scramble while the wire seals, then locks ONCE onto
   the real anchor (or the decision's own id if the wire stays silent). Used
   under a held-ask answer and under the aggregate held card alike — one queue,
   one truth. */
const HeldRowsList = memo(function HeldRowsList({ rows, onResolve }) {
  const list = (rows || []).filter((row) => row.decision_id);
  const keyOf = (row, i) => row.decision_id || `${row.agent_id || "hold"}-${i}`;

  /* A fresh set of decisions (different ids) restarts the walk; the same set
     mutating in place (a seal landing) does not. */
  const queueKey = list.map((row, i) => keyOf(row, i)).join("|");

  /* Which decisions are DONE is derived from the wire, not held in local state:
     a row with a sealedVerdict is resolved, and resolved rows form a prefix (the
     walk is strictly in order). This is what lets the queue survive the surface
     swapping HeldRowsList between its two mount points (held card vs answer
     overlay) when the operator asks mid-walk — a fresh instance re-derives the
     same position from the data and never replays already-sealed decisions.

     The ONE ephemeral piece: which resolved row is holding its seal ceremony on
     the glass right now (shown for its record-sealed beat before the walk moves
     on). If the component remounts mid-ceremony the walk simply resumes at the
     next unsealed decision — a skipped ceremony, never a replay. */
  const [sealingKey, setSealingKey] = useState(null);
  /* The number the CURRENT seal locks onto, decided ONCE so it never re-locks:
     { key, value }. Until it is set the seal shows the computing scramble — the
     number is never locked on a placeholder and then re-locked on the real one. */
  const [landTarget, setLandTarget] = useState(null);
  const advanceTimerRef = useRef(null);
  const scheduledKeyRef = useRef(null);

  useEffect(() => {
    setSealingKey(null);
    setLandTarget(null);
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
    scheduledKeyRef.current = null;
  }, [queueKey]);

  useEffect(
    () => () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    },
    []
  );

  /* The current decision: the one holding its seal ceremony, else the first not
     yet resolved. Resolved rows before it stay sealed (data), so a remount can
     never rewind the walk. */
  const currentIndex = list.findIndex(
    (row, i) => !row.sealedVerdict || keyOf(row, i) === sealingKey
  );
  const total = list.length;
  const current = currentIndex > -1 ? list[currentIndex] : null;
  const currentKey = current ? keyOf(current, currentIndex) : null;
  const hasNext = currentIndex > -1 && currentIndex < total - 1;
  const sealed = current?.sealedVerdict || null;
  const isSeal = sealed === "approved" || sealed === "refused";

  /* Decide the seal's sticky number, exactly once — and ONLY from truth: the
     real anchor the backend's /seal returns (current.sealedAnchor). There is no
     timer fallback and no locally-invented value: until the wire hands back the
     sealed anchor the number is not yet known, so the seal screen shows the
     honest computing mark (MappingMark) and never asserts a number the evidence
     chain didn't record. Once the real anchor arrives the sealed record swaps
     in ONE time on the anchor's arrival, not on a clock — rendered statically for
     a multi-row walk, or as the scramble-lock hero for a single-decision queue
     (which IS the dedicated seal surface); either way decided once, at render. */
  useEffect(() => {
    if (!isSeal || !current) return;
    if (landTarget && landTarget.key === currentKey) return; /* already decided */
    if (current.sealedAnchor) {
      setLandTarget({ key: currentKey, value: current.sealedAnchor });
    }
  }, [isSeal, current, currentKey, landTarget]);

  const target =
    isSeal && landTarget && landTarget.key === currentKey ? landTarget.value : null;
  const landed = Boolean(target);

  /* Advance once the seal has fully shown — a verdict whose number has LANDED, or
     a keep-holding that seals no number. The beat is measured from the landing,
     so the number is always seen to lock before the surface moves on. The last
     decision never advances: it rests on its seal, the finish. */
  useEffect(() => {
    if (!current || !hasNext) return;
    const readyToAdvance = sealed === "held" || (isSeal && landed);
    if (!readyToAdvance) return;
    if (scheduledKeyRef.current === currentKey) return;
    scheduledKeyRef.current = currentKey;
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null;
      /* Release the ceremony: the row is now resolved in the data, so clearing
         the sealing key drops the walk to the next unsealed decision. */
      morphSurface(() => setSealingKey((k) => (k === currentKey ? null : k)));
    }, sealed === "held" ? HELD_HOLD_BEAT_MS : HELD_SEAL_BEAT_MS);
  }, [current, sealed, currentKey, hasNext, isSeal, landed, sealingKey]);

  if (!current) return null;

  /* WHO & WHAT for the current row — the agent behind it and its actual ask.
     The layout flips ONLY on the new fields (agent_name / content_excerpt); a
     legacy row (agent_id + note, no new fields) renders exactly as before
     (note/kind line + provenance meta). The label may still fall back to
     agent_id, but only once a new field has already opened the who/what layout. */
  const rowExcerpt = heldRowExcerpt(current);
  const rowWhoWhat = Boolean(heldRowAgentName(current) || rowExcerpt);
  const rowAgent = rowWhoWhat ? heldRowAgentLabel(current) : null;

  /* Resolve the current decision: mark it as the one holding its seal ceremony
     (so the walk keeps showing it through its beat, even as the wire adds the
     verdict), then send the act to the backend. */
  const resolveCurrent = (verdict) => {
    setSealingKey(currentKey);
    onResolve(current, verdict);
  };

  return (
    <div
      className="tex-held-list tex-held-queue"
      role="group"
      aria-label={
        total > 1 ? `Held decision ${currentIndex + 1} of ${total}` : "Held decision"
      }
    >
      {total > 1 && (
        <p className="tex-held-progress" aria-hidden="true">
          {currentIndex + 1} / {total}
        </p>
      )}
      {current.sealedVerdict ? (
        /* The seal screen — the resolving decision alone on the glass. For a
           verdict seal the line does NOT claim "Sealed" until the backend's real
           anchor has arrived (target): while the wire computes it, the line reads
           a calm pending "Sealing…" and the mapping mark runs its one bounded
           pass (no number is asserted). The moment the true anchor is known the
           line flips to "Sealed." and the sealed anchor arrives — SWAPPED IN
           STATICALLY for a MULTI-row walk (a quiet state change, not a per-row
           ceremony), or COMPUTED ONTO THE GLASS as the scramble-lock hero for a
           single-decision queue (see below). The full hero stays reserved for the
           dedicated seal surface; a multi-row walk must never re-fire it — but a
           one-row queue IS that surface. Rests a beat, then the queue morphs to
           the next decision. */
        <div className="tex-held-seal" key={`${currentKey}-seal`} role="status">
          <p className="tex-held-seal-line">
            {current.sealedVerdict === "held"
              ? "Held. It waits for you."
              : !target
              ? "Sealing your decision."
              : current.sealedVerdict === "approved"
              ? "Sealed. You approved it."
              : "Sealed. You refused it."}
          </p>
          {isSeal ? (
            target &&
            (SEAL_ANCHOR_RE.test(target) || SEALED_NUMBER_RE.test(target)) ? (
              /* The walk states its sealed anchor STATICALLY — a quiet swap-in
                 at the standard state register, no per-row scramble. The full
                 scramble-lock hero (SealAnchor / ScrambleSeal) belongs ONLY to
                 the dedicated seal surface; a multi-row walk must not re-fire it.
                 A single-decision queue (total === 1) IS the dedicated seal
                 surface, so it earns the hero: the real 64-hex anchor computes
                 itself and locks. A multi-row walk still never re-fires it — it
                 keeps the quiet static swap-in. aria carries the plain value. */
              total === 1 && SEAL_ANCHOR_RE.test(target) ? (
                <SealAnchor hash={target} />
              ) : (
                <p
                  className="tex-seal-anchor tex-seal-anchor--static"
                  aria-label={target}
                >
                  {target}
                </p>
              )
            ) : (
              <MappingMark />
            )
          ) : null}
          {/* The seal's provenance, quiet in the instrument register (Geist,
             tracked, muted — the same voice the pq line uses on the dedicated
             seal surface): who resolved the hold, and that the record is signed.
             Both are additive — a legacy row without these fields renders exactly
             as before. HONESTY LAW: the words "post-quantum" appear ONLY when the
             signature is genuinely post_quantum; a classical signature reads a
             plain "sealed · <alg>". Shown only for a real verdict seal, never a
             keep-holding beat (keep-holding is not a seal). */}
          {isSeal && current.sealedResolvedBy && (
            <p className="tex-seal-sig">
              resolved by&nbsp;{current.sealedResolvedBy}
            </p>
          )}
          {isSeal && current.sealedSignature && (
            <p className="tex-seal-sig">
              {current.sealedSignature.post_quantum
                ? "post-quantum sealed"
                : "sealed"}
              &nbsp;·&nbsp;{current.sealedSignature.algorithm}
            </p>
          )}
        </div>
      ) : (
        <div className="tex-held-row" key={currentKey}>
          {rowWhoWhat ? (
            <>
              {rowAgent && <p className="tex-held-row-agent">{rowAgent}</p>}
              {rowExcerpt ? (
                <p className="tex-held-row-ask" title={rowExcerpt}>
                  {rowExcerpt}
                </p>
              ) : (
                <p className="tex-held-row-line">{heldRowLine(current)}</p>
              )}
              {heldRowTime(current) && (
                <p className="tex-held-row-meta">{heldRowTime(current)}</p>
              )}
            </>
          ) : (
            <>
              <p className="tex-held-row-line">{heldRowLine(current)}</p>
              {heldRowMeta(current) && (
                <p className="tex-held-row-meta">{heldRowMeta(current)}</p>
              )}
            </>
          )}
          <div className="tex-acts tex-held-row-acts">
            <button
              type="button"
              data-act="approve"
              className="tex-act tex-act--approve"
              onClick={() => resolveCurrent("approved")}
            >
              Approve
            </button>
            <button
              type="button"
              data-act="hold"
              className="tex-act tex-act--hold"
              onClick={() => resolveCurrent("held")}
            >
              Keep holding
            </button>
            <button
              type="button"
              data-act="refuse"
              className="tex-act tex-act--refuse"
              onClick={() => resolveCurrent("refused")}
            >
              Refuse
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

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
/* The deliberation mark — Tex's own initial, present and breathing. A single
   capital T in the voice register (Inter Light): not a spinner, not a fragment
   of machine truth — Tex itself, holding the beat while it weighs the answer
   against what it can prove. All motion lives in CSS, so reduced-motion users
   get a still, faint T for free. */
/* A propless breathing initial — memoized so it is never re-created while an
   answer's word clock ticks the monolith beside it. */
const DeliberationMark = memo(function DeliberationMark() {
  return (
    <span className="tex-deliberation-mark" aria-hidden="true">
      T
    </span>
  );
});

/* The generic hold sentence — the posture-true fallback Tex uses when the wire
   carries no typed sentence of its own. Named so the who/what card can tell an
   authored hold sentence apart from this stand-in and drop its redundant half. */
const GENERIC_HELD_SENTENCE =
  "I need to know if I can let this through. It's yours to decide.";

/* The same stand-in as the backend composes it — with the action type in
   parens ("…let this through (data_delete). It's yours to decide."). Either
   shape is the generic sentence, never an authored one. */
const GENERIC_HELD_SENTENCE_RE =
  /^I need to know if I can let this through(?:\s*\([^)]*\))?\.\s*It's yours to decide\.$/;

/* The line Tex speaks first when reached in a held state, or that the
   held card renders. Grounded in whatever the wire carries; posture-
   true fallbacks when it carries nothing yet. */
function heldSentence(decision) {
  return decision?.hold?.sentence || decision?.sentence || GENERIC_HELD_SENTENCE;
}
function heldDetail(decision) {
  return decision?.hold?.detail || decision?.detail || null;
}

/* WHO & WHAT — the agent behind a hold and its actual ask. The backend attaches
   these to the resolved hold detail (heldDetail's object); either present flips
   the card to the who/what presentation. Robust to a bare-string detail (old
   holds) and to a detail object that carries neither field — in both cases both
   return null and the card renders exactly as before (zero regression). */
function heldExtras(decision) {
  const d = heldDetail(decision);
  return d && typeof d === "object" ? d : null;
}
function heldAgentName(decision) {
  const d = heldExtras(decision);
  const name = d ? d.agent_name : null;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}
function heldContentExcerpt(decision) {
  const d = heldExtras(decision);
  const ex = d ? d.content_excerpt : null;
  return typeof ex === "string" && ex.trim() ? ex.trim() : null;
}

/* Tex's short line beneath a who/what card. An AUTHORED wire sentence is kept
   (it is Tex speaking, not the stand-in); the generic fallback's first half is
   redundant once the agent's ask is on the glass, so only "It's yours to decide."
   remains — the hand-off, in Tex's voice. */
function heldTexLine(decision) {
  const wire = decision?.hold?.sentence || decision?.sentence;
  const authored =
    typeof wire === "string" &&
    wire.trim() &&
    !GENERIC_HELD_SENTENCE_RE.test(wire.trim());
  return authored ? wire.trim() : "It's yours to decide.";
}

/* What the VOICE says when a hold arrives — the SAME hold the card renders,
   so the spoken and the written can never disagree: WHO and WHAT when the
   wire carries them (the agent, its own ask, then Tex's hand-off), the wire
   sentence otherwise. Composed only from grounded wire fields — never an
   invented word. */
function spokenHeldLine(decision) {
  const name = heldAgentName(decision);
  const ask = heldContentExcerpt(decision);
  if (name && ask) {
    return `${name} is asking: ${ask.replace(/[.…\s]+$/, "")}. ${heldTexLine(decision)}`;
  }
  if (name) return `${name} — ${heldTexLine(decision)}`;
  return heldSentence(decision);
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


/* The interactive answer — spoken in Tex's voice and HELD on the glass until the
   next reach begins (beginHold / a typed line clears it). It used to dissolve
   after 2.2–9s, which made hard answers unreadable and a failure indistinguishable
   from silence; an answer now stays put so it can be read back, and the next
   question naturally takes the surface. */

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

/* The wordless reach — "Here." A silent hold-and-release is a check-in, not a
   question: Tex answers it the way the law's "reach" state prescribes, with one
   calm word in the voice register that rises and, after a short linger, dissolves
   back to silence. It is ON-GLASS PRESENCE ONLY — never TTS. The product law is
   "Tex speaks only answers, zero audible filler", so this beat is SEEN, not heard. */
const HERE_LINE = "Here.";
const HERE_LINE_MS = 2_000;
/* How long an unsolicited held card owns the glass before it recedes on its
   own. The decision stays HELD — nothing is sealed by time — but the surface
   returns to silence: on a live estate holds arrive continuously, and a card
   that stands until resolved means the surface is never at rest again. */
const HELD_CARD_LINGER_MS = 10_000;
/* How soon a deferred held announce re-checks the voice. A spoken line runs
   ~6–10s; checking a few times inside that window voices the deferred hold
   promptly without ever barging it over the line mid-air. */
const ANNOUNCE_RETRY_MS = 4_000;

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

/* Does the engine auto-size an input to its content (CSS field-sizing: content)?
   Baseline in Chromium + Safari as of 2026. When it does, the typed line grows
   in the same frame as the key with nothing measured per keystroke; the hidden
   mirror + JS width read stay only as the fallback for engines without it. */
const FIELD_SIZING =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("field-sizing", "content");

/* How long the composing line stays pinned by its left edge after the last
   keystroke before it eases back to true-center (the horizontal freeze — text
   stops drifting sideways while a burst is live; a short pause re-centers it). */
const TYPING_SETTLE_MS = 450;

/* The FLUID-TRUTH ANSWER PIPELINE surface — the typed ask answered as an ordered
   list of SPANS (deterministic exhibits filling number-slots), each spoken in its
   own tier's prosody. Default-ON since 2026-07-07 (the /v1/answer backend is
   live in prod and verified end-to-end): the typed ask tries POST /v1/answer
   FIRST and falls back SILENTLY to the proven askTex → derivePresence →
   surfaceAnswer path on any fault (404/501/network), so the surface can never
   do worse than the legacy brain. Opt OUT with VITE_TEX_SPANS=0 — with the
   flag off every span branch below is dead and behavior is byte-identical to
   the pre-span surface. */
const SPANS_ENABLED = import.meta.env.VITE_TEX_SPANS !== "0";

/* The operator identity sealed into every human act (POST /seal → resolved_by).
   Defaults to the neutral "operator"; a build can name the seated operator with
   VITE_TEX_RESOLVER so the sealed record — and the walk's "resolved by" line —
   carries who actually resolved the hold. One source for both seal call sites. */
const TEX_RESOLVER = import.meta.env.VITE_TEX_RESOLVER || "operator";

/* ------------------------- THE BEGIN PASSCODE -------------------------
   A velvet rope over the day-one summons: pressing Begin no longer ignites
   discovery outright — it reveals a passcode field, and only the right word
   lets the summons through (see openGate / submitPasscode below).

   HONEST SCOPE — this is a CLIENT-SIDE gate. Vite inlines VITE_ env into the
   built bundle, so the word ships in the JS: it turns away a casual visitor, it
   does NOT withstand a determined one (who can read the bundle or call ignite
   directly). Real enforcement would live behind the backend's ignite endpoint;
   this is the surface-level lock, sized to a launch/demo surface.

   Sourced from VITE_TEX_BEGIN_PASSCODE, trimmed, with a placeholder fallback so
   the gate is NEVER accidentally open when the env var is unset (fail-closed).
   Set the real word in the environment — locally in .env.development, in prod via
   the Vercel dashboard (its build-time value overrides the committed default). */
const BEGIN_PASSCODE = (import.meta.env.VITE_TEX_BEGIN_PASSCODE || "VBTex").trim();

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
   animation in Vigil.css — --tex-t5, one rung under the manifesto's --tex-rise
   entrance per the exit-runs-faster rule). */
const MANIFESTO_LEAVE_MS = 420;
/* The handover line ("The weight is mine now.") cycles out of nothing — it
   arrives and stays. With the voice muted it has no spoken duration to hold on,
   so this is its silence-floor hold: long enough that the line LANDS and breathes
   before Begin fades in beneath it, instead of handing off the instant it appears.
   (Used as the third silenceHold entry; the spoken path still paces on the voice.) */
const MANIFESTO_FINAL_HOLD_MS = 1_800;

/* The shortest the "Mapping" state stays up, so a fast backend never makes it
   flash. One beat in the threshold's own rhythm (MANIFESTO_BEATS[0]) — long
   enough to read, never so long the timer is the thing the operator waits on:
   the law's ceiling is the wire, not a stopwatch. */
const MAP_MIN_MS = 1_200;

/* The keyed-posture watch sentinel. In production the same-origin proxy
   injects TEX_API_KEY and the backend resolves the estate from the key, so
   every scoped call already omits tenant_id (see scopedTenant in texApi).
   This value therefore NEVER reaches the wire — it exists only to open the
   client-side watch gate that the pre-key model left permanently closed in
   prod (held / seal / faltering could never surface). Fail-closed holds: a
   keyless or failing read returns nothing and the surface rests in silence. */
const KEYED_ESTATE = "keyed";

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
/* TypedLine — the composing line as its own memoized leaf.            */
/* ------------------------------------------------------------------ */

/* Keystroke-frequency state (`typed`, and the `ghost` derived from it) lives
   HERE, not in Vigil — so a keystroke re-renders this one small subtree instead
   of reconciling the whole surface, and the spoken-word highlight (Vigil state)
   can never touch it. Vigil learns only the EDGE — a line opened / closed — via
   onTypingChange, and hands down the two surface acts a reach performs: onBegin
   (clear the glass for a new question) and onSubmit (the grounded round-trip).
   The 'ghost lives OUTSIDE the input value' seamless design and the latent-mount
   are preserved verbatim; the completion lookup is deferred off the keystroke. */
const TypedLine = memo(function TypedLine({
  canType,
  isCoarsePointer,
  holding,
  watchTenant,
  onBegin,
  onSubmit,
  onTypingChange,
}) {
  const [typed, setTyped] = useState(null);
  const [ghost, setGhost] = useState("");
  const inputRef = useRef(null);
  const mirrorRef = useRef(null);
  const lineSlotRef = useRef(null);
  const rowRef = useRef(null);
  const typingRef = useRef(false); /* live mirror for the document key listener */
  const canTypeRef = useRef(false);
  const composingRef = useRef(false); /* an IME session owns its keys */
  const rosterNamesRef = useRef([]); /* real agent names; the GROUNDED vocabulary */
  const rosterLoadedRef = useRef(false);
  const assistRef = useRef(null); /* the loaded general-aid module, or "loading"/null */
  const lastDelRef = useRef(false); /* was the last edit a deletion → abstain the ghost */
  const wasTypingRef = useRef(false);
  /* Horizontal freeze — while a burst is live the line is pinned by its left edge
     (already-typed text stops drifting sideways per keystroke); a short pause
     clears the pin and CSS eases the now-longer line back to true-center. One
     measure per burst, never per key (so item-4's de-measuring is not undone). */
  const composingBurstRef = useRef(false);
  const settleTimerRef = useRef(null);

  /* Vigil needs only the boolean, and only on the EDGE — never per keystroke. */
  useEffect(() => {
    const now = typed !== null;
    typingRef.current = now;
    if (now !== wasTypingRef.current) {
      wasTypingRef.current = now;
      onTypingChange(now);
    }
  }, [typed, onTypingChange]);
  /* If the leaf unmounts mid-line (door / mapping takes the surface), tell Vigil
     the line closed so its guards can never wedge on a stale 'typing'. */
  useEffect(() => () => onTypingChange(false), [onTypingChange]);
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
     unambiguously prefixes; else a grounded question completion; else a common
     English word. Abstains ("") on ambiguity — completes only toward what Tex
     can prove, and only when it is sure. */
  const computeGhost = useCallback((text, isDeletion) => {
    if (isDeletion || !text) return "";
    const m = text.match(/(\S+)$/);
    const frag = m ? m[1] : "";
    const lower = frag.toLowerCase();
    if (frag.length >= 2) {
      const hits = rosterNamesRef.current.filter(
        (n) => n.length > frag.length && n.toLowerCase().startsWith(lower)
      );
      if (hits.length === 1) return hits[0].slice(frag.length);
      if (hits.length > 1) return "";
    }
    const q = completeAsk(text);
    if (q) return q;
    if (frag.length >= 2) {
      const a = assistRef.current;
      if (a && a.complete) {
        const suf = a.complete(frag, 3);
        if (suf) return suf;
      }
    }
    return "";
  }, []);

  /* When a completed line's trailing token IS a real agent, commit it in the
     agent's TRUE casing — so accepting/submitting "claimp"→"ClaimPulse" sends the
     real entity name, never a lowercased echo. No match → unchanged. */
  const canonicalizeTail = useCallback((text) => {
    const m = text.match(/(\S+)$/);
    if (!m) return text;
    const real = rosterNamesRef.current.find(
      (n) => n.toLowerCase() === m[1].toLowerCase()
    );
    return real ? text.slice(0, text.length - m[1].length) + real : text;
  }, []);

  /* GROUNDED COMPLETION off the CRITICAL PATH: `typed` is urgent (the caret never
     lags), the ghost is derived from a DEFERRED copy so the completion lookup can
     never block the keystroke. A deletion or an IME session abstains. The ghost
     stays STATE so the accept gesture can clear it in the same frame (no flash). */
  const deferredTyped = useDeferredValue(typed);
  useEffect(() => {
    if (composingRef.current) return;
    if (deferredTyped == null || lastDelRef.current) {
      setGhost("");
      return;
    }
    setGhost(computeGhost(deferredTyped, false));
  }, [deferredTyped, computeGhost]);

  /* Pin the line's left edge for the length of a burst — one measure at the
     burst's start (equal to the current true-center, so no jump), held while the
     line grows rightward, cleared on the pause so CSS eases it back to center. */
  const freezeBeat = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    if (!composingBurstRef.current) {
      composingBurstRef.current = true;
      const w = row.getBoundingClientRect().width;
      row.style.transform = `translateX(${-(w / 2)}px)`;
    }
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      composingBurstRef.current = false;
      const r = rowRef.current;
      if (r) r.style.transform = ""; /* eases to CSS translateX(-50%) over --tex-t3 */
    }, TYPING_SETTLE_MS);
  }, []);

  const clearFreeze = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    composingBurstRef.current = false;
    const r = rowRef.current;
    if (r) r.style.transform = "";
  }, []);

  const cancelTyping = useCallback(() => {
    setTyped(null);
    setGhost("");
    typingRef.current = false;
    lastDelRef.current = false;
    clearFreeze();
    const el = inputRef.current;
    if (el) {
      try {
        el.blur();
      } catch {
        /* ignore */
      }
    }
  }, [clearFreeze]);

  /* Begin a typed line with its first character already in it — the latent input
     is already mounted, so focus + caret land inside this keystroke, synchronously
     (no mount gap). onBegin clears Vigil's own surface (the wedge-guard); the
     voice-unlock and roster/aid load are local so priming never re-renders Vigil. */
  const beginTyping = useCallback(
    (firstChar) => {
      unlockVoice();
      loadRoster();
      loadAssist();
      onBegin();
      setTyped(firstChar);
      setGhost(""); /* one char is too short to complete — abstain */
      lastDelRef.current = false;
      typingRef.current = true;
      const el = inputRef.current;
      if (el) {
        try {
          el.removeAttribute("aria-hidden");
          el.tabIndex = 0;
          el.focus();
        } catch {
          /* ignore */
        }
      }
    },
    [onBegin, loadRoster, loadAssist]
  );

  /* Submit — read the full displayed line (words + any accepted ghost, in the
     agent's true casing), dissolve the leaf, and hand the question up to Vigil's
     grounded round-trip. */
  const submitTyped = useCallback(() => {
    const q = canonicalizeTail((typed ?? "") + ghost).trim();
    cancelTyping();
    onSubmit(q);
  }, [typed, ghost, canonicalizeTail, cancelTyping, onSubmit]);

  /* The input owns its own keys. Enter asks; Escape dissolves; Tab / ArrowRight-
     at-end / End accepts the ghost (the ONLY way suggestion text becomes typed
     text); an in-flight IME composition is left to finish. */
  const onTypedKeyDown = useCallback(
    (e) => {
      e.stopPropagation();
      if (composingRef.current || e.isComposing || e.keyCode === 229) return;
      if (ghost && (e.key === "ArrowRight" || e.key === "Tab" || e.key === "End")) {
        const el = inputRef.current;
        const atEnd =
          !el ||
          (el.selectionStart === el.selectionEnd &&
            el.selectionStart === (typed ?? "").length);
        if (e.key !== "ArrowRight" || atEnd) {
          e.preventDefault();
          const full = canonicalizeTail((typed ?? "") + ghost);
          setTyped(full);
          setGhost("");
          requestAnimationFrame(() => {
            const node = inputRef.current;
            if (node) {
              try {
                const n = node.value.length;
                node.setSelectionRange(n, n);
              } catch {
                /* ignore */
              }
            }
          });
          return;
        }
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

  /* Losing focus with nothing typed dissolves the line; a line with content stays
     (e.g. the mobile keyboard dismissed) so a half-typed question isn't lost. */
  const onTypedBlur = useCallback(() => {
    if (!typed || !typed.trim()) cancelTyping();
  }, [typed, cancelTyping]);

  /* Every keystroke: store the words EXACTLY as typed (the ghost is derived off a
     deferred copy, above — not here, so completion never blocks the key) and beat
     the horizontal freeze. Nothing rewrites what was typed. */
  const onTypedChange = useCallback(
    (e) => {
      const value = e.target.value;
      const it = (e.nativeEvent && e.nativeEvent.inputType) || "";
      lastDelRef.current = it.startsWith("delete");
      setTyped(value);
      freezeBeat();
    },
    [freezeBeat]
  );

  /* Desktop "just start typing" + blurred-line recovery — one document-level
     keydown. Defers entirely once the field owns the keys or typing is inert. */
  useEffect(() => {
    if (!TYPING_ENABLED) return undefined;
    const guarded = () => {
      const ae = document.activeElement;
      return !!(
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable ||
          (ae.closest && ae.closest("[data-act]")))
      );
    };
    const onDocKeyDown = (e) => {
      if (typingRef.current) {
        const el = inputRef.current;
        if (!el || document.activeElement === el) return; /* field owns the keys */
        if (e.isComposing || e.keyCode === 229) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!e.key || e.key.length !== 1 || e.key === " ") return;
        if (guarded()) return;
        try {
          el.removeAttribute("aria-hidden");
          el.tabIndex = 0;
          el.focus();
        } catch {
          /* ignore */
        }
        return;
      }
      if (!canTypeRef.current) return;
      if (e.isComposing || e.keyCode === 229) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.key || e.key.length !== 1 || e.key === " ") return;
      if (guarded()) return;
      e.preventDefault();
      beginTyping(e.key);
    };
    document.addEventListener("keydown", onDocKeyDown);
    return () => document.removeEventListener("keydown", onDocKeyDown);
  }, [beginTyping]);

  /* A voice reach supersedes an open typed line. */
  useEffect(() => {
    if (holding && typed !== null) cancelTyping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding]);

  /* Size the input to EXACTLY the typed text — a no-op where the engine auto-sizes
     it (field-sizing: content); only the fallback engines pay the mirror read. */
  useLayoutEffect(() => {
    if (FIELD_SIZING) return;
    const el = inputRef.current;
    if (!el) return;
    if (typed === null) {
      el.style.width = ""; /* latent: the CSS class owns the 1px width */
      return;
    }
    const mirror = mirrorRef.current;
    if (!mirror) return;
    el.style.width = `${Math.ceil(mirror.getBoundingClientRect().width) + 2}px`;
  }, [typed]);

  /* Lift the composing line above the on-screen keyboard (touch only). */
  useEffect(() => {
    if (!isCoarsePointer || typeof window === "undefined") return undefined;
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const apply = () => {
      const slot = lineSlotRef.current;
      if (!slot) return;
      const offset = vv.offsetTop + (vv.height - window.innerHeight) / 2;
      slot.style.setProperty("--tex-kb-offset", `${Math.min(0, Math.round(offset))}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, [isCoarsePointer]);

  return (
    <>
      {/* One visual line: a hidden mirror (fallback measure), the real input sized
          to exactly the typed text, and the ghost — the suggestion — floated OUT
          of the flow, anchored to the caret end, so a suggestion fades in beside
          the caret and never shoves the words or pops. The input's value is only
          ever the operator's words; native autocorrect is OFF. */}
      <div className="tex-line-slot" ref={lineSlotRef}>
        <div
          className={"tex-line-row" + (typed === null ? " tex-line-row--latent" : "")}
          ref={rowRef}
        >
          <span ref={mirrorRef} className="tex-line-mirror" aria-hidden="true">
            {typed ?? ""}
          </span>
          <span className="tex-line-field">
            <input
              ref={inputRef}
              data-act="write"
              className={"tex-line" + (typed === null ? " tex-line--latent" : "")}
              value={typed ?? ""}
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
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              aria-label="Type your question to Tex"
              aria-hidden={typed === null ? true : undefined}
              tabIndex={typed === null ? -1 : 0}
            />
            <span
              className={"tex-ghost" + (typed !== null && ghost ? " is-shown" : "")}
              aria-hidden="true"
            >
              {ghost}
            </span>
          </span>
        </div>
      </div>

      {/* The single resident concession on touch: one tiny static mark the operator
          taps to raise the keyboard (the only way iOS opens it — synchronous focus
          inside the tap). data-act so the tap focuses the line, not the mic. */}
      {isCoarsePointer && canType && typed === null && (
        <button
          type="button"
          data-act="write"
          className="tex-write-glyph"
          aria-label="Type a question to Tex"
          onClick={(e) => {
            e.stopPropagation();
            /* A tap is a valid audio-unlock gesture — a typed-first session must
               not render its first answer silent (see beginTyping). */
            unlockVoice();
            loadRoster();
            loadAssist();
            const el = inputRef.current;
            if (el) {
              try {
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
    </>
  );
});

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Vigil() {
  /* The day-one threshold. Server-authoritative: whether Tex has begun
     lives in the backend, not localStorage. While the status read is in
     flight the surface renders nothing (silence is the resting truth, not
     a spinner), so a returning operator never sees a flash of the door. */
  const ignition = useIgnition();

  /* The estate Tex watches. In the keyed (production) posture the tenant IS
     the key's principal — the operator's own estate, resolved server-side
     from TEX_API_KEY — so the watch gate opens with KEYED_ESTATE (a sentinel
     that never reaches the wire; scopedTenant omits tenant_id in prod). No
     simulated/default estate can leak onto the glass: the key's estate is by
     definition the connected one, and a keyless or failing read fails closed
     back to silence. DEV stays explicit — watch only a directory the operator
     connected, or VITE_TEX_TENANT as the local convenience (DEV-only). */
  const watchTenant =
    ignition.connectedTenant ||
    (import.meta.env.DEV ? import.meta.env.VITE_TEX_TENANT : KEYED_ESTATE) ||
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
     discovery on the backend; it holds the field with the nascent anchor
     (MappingMark) while the wire works, then dissolves to Tex speaking
     the count. */
  const [mapping, setMapping] = useState(false);
  const mappingTimer = useRef(null);
  const clearMappingTimer = () => {
    if (mappingTimer.current) clearTimeout(mappingTimer.current);
    mappingTimer.current = null;
  };

  /* The Begin passcode gate (see BEGIN_PASSCODE). `gateOpen` reveals the
     passcode field once Begin is pressed; `passInput` is the word being typed;
     `passWrong` flashes a quiet reject on a mismatch (cleared on the next
     keystroke). The field lives in the door's reserved act slot, so revealing it
     never reflows the manifesto above. */
  const [gateOpen, setGateOpen] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [passWrong, setPassWrong] = useState(false);
  const passInputRef = useRef(null);

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
  /* Every held SENTENCE Tex has voiced this session. A live estate mints the
     same ask over and over (an agent retrying its one risky action), and every
     retry is a NEW id — an id-keyed guard alone re-voices the identical words
     on every fresh hold, which the operator hears as Tex stuck repeating
     himself. Words already spoken carry no new information: identical
     sentences are consumed silently; a DIFFERENT ask always voices. */
  const spokenHeldSentencesRef = useRef(new Set());
  /* The deferred-announce retry: when a hold lands while a line is mid-air,
     the announce waits (never barges Tex over Tex) and re-checks shortly. */
  const announceRetryRef = useRef(null);
  const [announceTick, setAnnounceTick] = useState(0);
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

  /* A HUMAN hold is on the glass — a decision (single or aggregate) waiting on
     the operator's seal, as opposed to a calibration proposal. This is the
     gate for the COUNT-FIRST presentation below: the card leads with how many
     decisions wait, never with one decision's card while others hide behind
     it. */
  const humanHold = Boolean(
    state === "held" && liveDecision && !isCalibration(liveDecision)
  );

  /* TYPE TO WRITE — the transient typed line now lives in the memoized <TypedLine>
     leaf (below the return), so a keystroke re-renders one element, not this whole
     surface. Vigil keeps only the EDGE — whether a line is open — for the guards
     that pause the held-linger, block idle, recede the card, and hide the trail
     while a question is forming. The ask gesture is inert in exactly the states the
     voice reach is: not before ignition, not over the day-one door, not mapping. */
  const [isTyping, setIsTyping] = useState(false);
  const onTypingChange = useCallback((v) => setIsTyping(v), []);
  const [isCoarsePointer] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches
  );
  const canType = TYPING_ENABLED && ignitionReady && !ignitionDoorOpen && !mapping;

  /* Interaction state. */
  const [holding, setHolding] = useState(false);
  const [thinking, setThinking] = useState(false);
  /* The gate-verification moment. True while /v1/ask is in flight — Tex weighing
     the answer against what it can prove. This is rendered as a DELIBERATE pause
     (a slow, breathing mark), a presence signal that reads as deliberation, not
     lag (CHI 2026). It is the visual twin of the spoken presence ack. */
  const [verifying, setVerifying] = useState(false);
  /* The heard line — the operator's own words, live while the mic is held.
     Interim transcripts stream in as they speak (proof of hearing BEFORE the
     release), and the release settles the line to the final transcript. The
     interim/final distinction is rendered as faint→ink, the same register
     shift every serious 2026 voice UI uses (Deepgram interim-results model). */
  const [heard, setHeard] = useState("");
  /* The speculative ask in flight for THIS hold: { q, promise, ctrl } where q
     is the normalized partial it bet on and ctrl is the bet's AbortController.
     Redeemed at release iff the final transcript normalizes to the same q;
     otherwise abandoned — and an abandoned bet is ABORTED, not just dropped:
     the promise's catch is silenced client-side, but only the abort frees the
     single-worker backend, which would otherwise finish computing an answer
     nobody will read while the TTS fetch queues behind it. */
  const specRef = useRef(null);
  const specTimerRef = useRef(null);
  /* Abandon the live bet, if any: abort the wire and clear the slot. The
     promise rejects into the no-op catch attached at bet time. Never called
     on the redeem path — a redeemed bet's controller stays live with it. */
  const abandonBet = () => {
    if (specRef.current) {
      specRef.current.ctrl.abort();
      specRef.current = null;
    }
  };
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
  /* The lit word (0-based), -1 = finished/full ink, WORD_PENDING = mounted but
     not yet voiced (every word faint, so the line reveals strictly forward). */
  const [answerWord, setAnswerWord] = useState(-1);
  /* True once the voice has lit a real word this turn: it separates the leading
     onWord(-1) (before word 0 — hold PENDING, stay faint) from the trailing
     onWord(-1) (line finished — resolve to full ink). Without it the answer
     would flash full-bright the instant it mounts, then dim its unspoken tail. */
  const answerLitRef = useRef(false);
  const [answerLeaving, setAnswerLeaving] = useState(false);
  /* The FLUID-TRUTH span answer, when VITE_TEX_SPANS is on: the whole
     AnswerResponse (spans + exhibits) plus the question that produced it. Null at
     rest and whenever the flag is off, so the default surface is untouched. The
     spoken-word highlight rides the shared answerWord (spans speak sequentially,
     one concatenated line). */
  const [spanAnswer, setSpanAnswer] = useState(null);
  /* Live mirror of `answer` for the retire path — a ref, not state, so
     retiring the standing turn into the trail never reads a stale closure. */
  const answerRef = useRef(null);
  /* Live mirror of the SPAN answer for the same retire path: { question,
     text } where text is the spoken concatenation. Without it a span turn
     vanished on the next reach instead of receding into the trail —
     surfaceSpanAnswer nulls answerRef by design (only one answer surface
     shows), so retireAnswer had nothing to read for span turns. */
  const spanAnswerRef = useRef(null);
  /* The conversation trail: prior turns as { id, q, a }, oldest first. Display
     only — the backend's follow-up context stays the single lastExchangeRef. */
  const [trail, setTrail] = useState([]);
  const trailIdRef = useRef(0);
  /* The held rows risen under a held-ask answer — each resolvable in place
     with the same three acts the held card carries. Belongs to the CURRENT
     answer; cleared with it. */
  const [heldRows, setHeldRows] = useState(null);
  /* The COUNT behind the held card — every decision actually waiting, read
     from the same /held sink the walk resolves (one queue, one truth). null
     while the read is on the wire (the card holds back a beat — silence,
     never a flash); an empty list means /held could not speak or holds
     nothing walkable, and the card falls back to the single-decision
     presentation the frame itself carries. The summary is a posture, never a
     gate that can hide a real hold. */
  const [heldWaiting, setHeldWaiting] = useState(null);
  /* The rows the walk will actually show, live-filtered as seals land this
     session (bumpDismissed re-renders us), so the count the card speaks can
     never disagree with the queue behind the act. */
  const heldWaitingLive = heldWaiting
    ? heldWaiting.filter((r) => !dismissedRef.current.has(r.decision_id))
    : null;
  const heldWaitingCount = heldWaitingLive ? heldWaitingLive.length : 0;
  const heldWaitingLine =
    heldWaitingCount === 1
      ? "1 held decision is waiting for you."
      : `${heldWaitingCount} held decisions are waiting for you.`;
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
    answerRef.current = null;
    spanAnswerRef.current = null;
    setAnswer(null);
    setAnswerWord(-1);
    setAnswerLeaving(false);
    setHeldRows(null);
    setSpanAnswer(null);
  }, []);

  /* A new reach takes the surface — but the standing turn does not vanish:
     it recedes into the trail (smaller, fainter, above the answer that
     replaces it), so a follow-up is asked over words still on the glass.
     Span answers retire exactly like plain ones — one trail, both voices.
     Only "refresh" (refreshSurface) and Escape wipe the trail itself. */
  const retireAnswer = useCallback(() => {
    const a = answerRef.current;
    const s = spanAnswerRef.current;
    const standing = a?.text ? a : s?.text ? s : null;
    if (standing) {
      trailIdRef.current += 1;
      const entry = {
        id: trailIdRef.current,
        q: standing.question || "",
        a: standing.text,
      };
      setTrail((t) => [...t, entry].slice(-TRAIL_MAX));
    }
    /* Revive the designed dissolve: the plain answer does not hard-cut — it fades
       on its is-leaving path (tex-object-fade, --tex-t3) as its trail copy rises
       above it, then clears. Only the plain-answer surface carries is-leaving, so
       a standing SPAN turn (no fade wired) still clears at once. The deferred
       clear is gated by answerEpochRef — surfaceAnswer bumps it when a new turn
       takes the glass — so a fast re-ask inside the leave beat is never clobbered
       by this turn's pending clear. */
    if (!a?.text) {
      clearAnswer();
      return;
    }
    clearAnswerTimer();
    setAnswerLeaving(true);
    /* The retire path's live mirrors drop NOW (the DOM stays up on `answer`
       state through the fade) so a second retire inside the leave beat finds
       nothing standing and can't re-push this turn into the trail. */
    answerRef.current = null;
    spanAnswerRef.current = null;
    const leavingEpoch = answerEpochRef.current;
    answerTimer.current = setTimeout(() => {
      answerTimer.current = null;
      if (answerEpochRef.current !== leavingEpoch) return; /* a new turn took the glass */
      clearAnswer();
    }, ANSWER_LEAVE_MS);
  }, [clearAnswer]);

  /* Generation token for the ASK round-trip — the request-level twin of
     answerEpochRef (the same idiom texVoiceClient's speech engine uses).
     Bumped whenever a new reach takes the surface (a press, a typed line, a
     seal act, an Escape); every in-flight /v1/ask captures the value it was
     born under and, on resolve, surfaces NOTHING if the epoch has moved. A
     superseded answer must never take the glass out from under the turn that
     replaced it. */
  const askEpochRef = useRef(0);

  /* The in-flight ask's cancel handle (typed reach). A superseding reach — a new
     typed line, a voice press, a refresh — aborts it, so a request the operator
     has already moved past stops consuming the single backend worker and its
     answer's TTS is never queued behind a dead one. The voice path (endHold) has
     always minted its own controller; this brings the typed path to parity. */
  const askAbortRef = useRef(null);
  const abortAsk = useCallback(() => {
    if (askAbortRef.current) {
      try { askAbortRef.current.abort(); } catch {}
      askAbortRef.current = null;
    }
  }, []);

  /* Day-one wake — the wake gesture exists ONLY to satisfy browser autoplay: the
     first reach unlocks audio so Tex can speak the manifesto. With the voice muted
     (VOICE_ENABLED false) there is nothing to unlock, so the opener begins on its
     own — awake starts true and "touch to wake" never shows. When the voice is
     restored, awake starts false again and the wake invitation returns, because
     audio still needs that first gesture. */
  const [awake, setAwake] = useState(!VOICE_ENABLED);

  /* Speak a presence answer in Tex's voice AND surface it on the glass — the
     spoken line, the credibility tier the gate sealed, the abstain reason when it
     abstains, and any claims you can reach into. The text and the tier are
     whatever /v1/ask sealed; this never authors or edits them (derivePresence
     only normalizes the wire). It speaks WORD-SYNCED at streaming latency
     (texSpeakSynced: the streamed-timestamp path, falling back to the
     full-clip timed path, the plain stream, then honest silence) — the line
     mounts at full ink, and the voice re-inks it word by word as it speaks,
     the seal's char-by-char lock extended to the answer. The answer STAYS on
     the glass until the next reach (beginHold / a typed line) takes the
     surface — it no longer dissolves on a timer, so it can be read back at
     the operator's pace. */
  const surfaceAnswer = useCallback((presence, question) => {
    const text = presence?.spokenText;
    if (!text) return;
    clearLineTimer();
    clearAnswerTimer();
    const next = {
      text,
      /* The operator's own words, kept with the answer they produced: shown
         faint above the line, and carried into the trail when a new reach
         retires this turn. */
      question: question || null,
      tier: presence.tier || null,
      tierReason: presence.tierReason || null,
      claims: presence.claims || [],
      proof: presence.proof || null,
    };
    /* The answer TAKES the glass as one morph — the deliberation mark and
       the heard line dissolve into the spoken line, never a hard swap. The
       thinking/verifying flags clear INSIDE the morph (clearing them any
       earlier unmounts the mark before the old snapshot is captured — a
       pop), and a stale epoch applies nothing: the VT callback runs a frame
       late, and a reach landing in that gap owns the surface.

       `pending` mounts every word faint (the voiced case), so the line only
       ever brightens FORWARD as the voice reaches each word — never the
       reverse-ink flash of mounting full-bright and dimming the unspoken tail. */
    const myEpoch = askEpochRef.current;
    let surfaced = false;
    const takeGlass = (pending) => {
      if (surfaced) return;
      surfaced = true;
      morphSurface(() => {
        if (myEpoch !== askEpochRef.current) return; /* superseded — stay quiet */
        answerRef.current = next;
        setSpoken(null);
        setThinking(false);
        setVerifying(false);
        setAnswerLeaving(false);
        answerLitRef.current = false;
        setAnswerWord(pending ? WORD_PENDING : -1);
        setAnswer(next);
        /* Only one answer surface shows: a plain answer retires any span stack. */
        spanAnswerRef.current = null;
        setSpanAnswer(null);
      });
    };
    answerEpochRef.current += 1; /* supersede any stale playback of a prior answer */

    if (!VOICE_ENABLED) {
      /* Muted (today's prod): no voice to sync to — the answer lands at once,
         at full ink, exactly as it always has. */
      takeGlass(false);
      texSpeakSynced(text, { prosody: presence.prosodyToken });
      return;
    }

    /* Voiced: DEFER the morph to the first audible word (onAudioStart), so the
       deliberation mark keeps breathing until text and voice arrive together —
       the answer never sits silent and finished-looking ahead of its own voice.
       onWord then reveals it strictly forward; a trailing onWord(-1) resolves to
       full ink only once a real word has lit. If the voice never sounds (cold or
       dead backend → honest silence), the answer still surfaces at full ink when
       the speech promise resolves — never stranded on a breathing mark.
       Forward the gate's verdict token so the ANSWER is spoken in-tier (only gate
       verdicts get a token; the opener / "Here." / a falter stay NEUTRAL). */
    texSpeakSynced(text, {
      prosody: presence.prosodyToken,
      /* The timed paths fire onAudioStart bare → pending mount, words brighten
         forward. The plain-voice fallback fires it { untimed: true } — it has
         no word ticks coming, so the text lands at full ink with the voice. */
      onAudioStart: (info) => takeGlass(!(info && info.untimed)),
      onWord: (i) => {
        if (i >= 0) {
          answerLitRef.current = true;
          setAnswerWord(i);
        } else {
          setAnswerWord(answerLitRef.current ? -1 : WORD_PENDING);
        }
      },
    }).finally(() => {
      takeGlass(false);
      /* A voice that surfaced pending but died before its first word tick must
         not strand the answer faint — resolve any straggling pending ink. */
      if (myEpoch === askEpochRef.current) {
        setAnswerWord((w) => (w === WORD_PENDING ? -1 : w));
      }
    });
  }, []);

  /* Take the surface with a FLUID-TRUTH span answer (VITE_TEX_SPANS only).
     The whole AnswerResponse renders as an ordered stack of spans, and Tex
     voices them SEQUENTIALLY — one span at a time, each in its OWN tier's
     prosody token — using the existing timed voice engine.

     Sequential chaining is safe with the current engine: each texSpeakSynced
     opens by superseding the voice epoch, so we AWAIT each span to its natural
     end before starting the next (the finished span is already done, so the
     next span's supersede is harmless), and we re-check our ask epoch between
     spans so a fresh reach (a new press / typed line, which bumps
     askEpochRef) silently ends the sequence. The highlight rides the shared
     answerWord as a GLOBAL word index across the concatenated spoken text, so
     each span lights up only while the voice is inside its own token range —
     the offset math lives in SpanAnswer. Muted voice degrades cleanly (each
     texSpeakSynced is a no-op and resolves at once), so the stack still
     renders in full silence. */
  const surfaceSpanAnswer = useCallback((res, question) => {
    const spans = Array.isArray(res?.spans) ? res.spans : [];
    if (!spans.length) return;
    clearLineTimer();
    clearAnswerTimer();
    const myEpoch = askEpochRef.current;
    /* The span stack TAKES the glass as one morph, retiring any plain answer
       (only one answer surface shows) and clearing the thinking/verifying marks
       inside the morph exactly as surfaceAnswer does. A stale epoch applies
       nothing. */
    morphSurface(() => {
      if (myEpoch !== askEpochRef.current) return; /* superseded — stay quiet */
      answerRef.current = null;
      setAnswer(null);
      setSpoken(null);
      setThinking(false);
      setVerifying(false);
      setAnswerLeaving(false);
      setAnswerWord(-1);
      /* The retire mirror: what the trail will keep of this turn — the
         operator's words and the spoken concatenation, never the exhibits. */
      spanAnswerRef.current = {
        question: question || "",
        text:
          res?.spoken_text ||
          spans.map((s) => s?.text || "").join(" ").trim(),
      };
      setSpanAnswer({ res, question: question || null });
    });
    answerEpochRef.current += 1; /* supersede any stale playback of a prior answer */

    /* Speak the spans one after another, each with its own prosody token. The
       word index is global across the concatenation, so it advances by the
       running offset of all prior spans' words. */
    /* prosody === lowercase verdict per the contract; prefer the span's own
       token, fall back to the verdict lowercased. */
    const spanProsody = (span) =>
      span?.prosody || (span?.verdict ? String(span.verdict).toLowerCase() : null);

    (async () => {
      let wordOffset = 0;
      for (let k = 0; k < spans.length; k += 1) {
        if (myEpoch !== askEpochRef.current) return; /* a fresh reach won */
        const span = spans[k];
        const text = span?.text || "";
        const tokens = text.split(/\s+/).filter(Boolean).length;
        const base = wordOffset;
        if (text) {
          /* A superseded span returns early inside the engine and our epoch
             check ends the loop. Warm span k+1's audio the instant span k
             begins to sound, in ITS OWN tier's tone, so the voice never goes
             silent paying a fresh TTS connect between spans. */
          const nextSpan = spans[k + 1];
          const nextText = nextSpan?.text || "";
          const prefetchNext = nextText
            ? { text: nextText, prosody: spanProsody(nextSpan) || "" }
            : undefined;
          // eslint-disable-next-line no-await-in-loop
          await texSpeakSynced(text, {
            prosody: spanProsody(span),
            prefetchNext,
            onWord: (i) => {
              if (myEpoch === askEpochRef.current) setAnswerWord(base + i);
            },
          });
        }
        wordOffset += tokens;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The never-silent rule: a failed or empty round-trip SAYS SO, in Tex's one
     voice, as an honest abstain-tier line — a network error must never be
     indistinguishable from "the information does not exist". */
  const surfaceFailure = useCallback(
    (text, question) => {
      surfaceAnswer(
        { spokenText: text, tier: "abstain", claims: [], proof: null },
        question
      );
    },
    [surfaceAnswer]
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

  /* ---------------- The held card's linger ----------------
     An unsolicited hold owns the glass only for a breath: HELD_CARD_LINGER_MS
     after the card is alone and readable, it RECEDES on its own. The decision
     stays HELD — it keeps its place in the queue and the counts, the deciding
     wash keeps breathing its weight, and nothing is ever sealed by time — but
     the surface returns to rest instead of standing occupied forever on an
     estate that raises holds continuously. The next NEW hold pops fresh with
     its own linger; the operator can always pull the queue back ("show the
     held decisions"). The clock runs only while the card is actually readable:
     an overlay (answer, span stack, verification, a typed line) or a live
     press pauses it. */
  const [heldReceded, setHeldReceded] = useState(null);
  /* The key whose announce has SETTLED — voiced to its natural end, or
     consumed silently (words already spoken, muted voice). The linger clock
     may only start once this matches the standing card: a hold pending
     behind the day-one episode (or behind a line still mid-air) has not had
     its moment yet, and receding it early would swallow the announce — the
     card would be born invisible the instant the episode ends. */
  const [announcedKey, setAnnouncedKey] = useState(null);
  const heldLingerTimer = useRef(null);
  useEffect(() => {
    if (heldLingerTimer.current) {
      clearTimeout(heldLingerTimer.current);
      heldLingerTimer.current = null;
    }
    if (state !== "held" || !dismissKey) return undefined;
    /* The card is not on the glass during the day-one episode (the door, the
       mapping, the spoken count own the surface end-to-end) — the same guards
       the announce obeys. A clock that ran here would recede a card that was
       never readable. */
    if (ignitionDoorOpen || mapping || spoken?.kind === "ignite")
      return undefined;
    /* The COUNT-FIRST summary (and the walk it opens) never recedes: how many
       decisions wait IS the vigil's at-rest truth, and a returning operator
       must find it standing, not faded. The linger clock belongs only to the
       presentations that predate it — a calibration proposal, or the fallback
       single card when /held could not speak. */
    if (humanHold && (heldWaiting === null || heldWaitingCount > 0))
      return undefined;
    if (heldReceded === dismissKey) return undefined; /* already receded */
    if (answer || spanAnswer || verifying || isTyping || holding)
      return undefined; /* card not readable — the clock starts when it is */
    /* The announce comes first: the clock starts only after this hold's
       announce has settled (spoken to the end, or consumed silently), so a
       deferred announce is never orphaned by its own card receding — and the
       voice never narrates a card that has already left the glass. */
    if (announcedKey !== dismissKey) return undefined;
    heldLingerTimer.current = setTimeout(() => {
      heldLingerTimer.current = null;
      morphSurface(() => setHeldReceded(dismissKey));
    }, HELD_CARD_LINGER_MS);
    return () => {
      if (heldLingerTimer.current) {
        clearTimeout(heldLingerTimer.current);
        heldLingerTimer.current = null;
      }
    };
  }, [state, dismissKey, answer, spanAnswer, verifying, isTyping, holding, heldReceded, humanHold, heldWaiting, heldWaitingCount, announcedKey, ignitionDoorOpen, mapping, spoken]);

  /* ---------------- A held decision speaks first, unprompted ----------------
     A HELD decision is one of the only two surfaces allowed to break the
     silence at rest (the other is "Tex is down"). When a NEW one arrives, Tex
     voices its held sentence ONCE, on its own, the instant it lands — the same
     line the card already renders, so the spoken and the written hold agree.

     Said once per held id AND once per SENTENCE: lastSpokenHeldIdRef stops a
     re-fire on a later /v1/vigil frame for the same hold, and
     spokenHeldSentencesRef stops a re-voice when a NEW id carries words Tex
     has already said this session (a live estate mints the same ask over and
     over; repeating it is noise, not information — the card and the queue
     still carry every hold). A different ask speaks fresh — but never OVER a
     line mid-air: if the voice is busy the announce DEFERS and retries,
     because a barge-in restart is heard as Tex stuttering over himself.
     Gated to a settled surface — never over the operator's turn
     (holding), a question round-trip (thinking/verifying), or a dead wire
     (alive). A dismissed hold is already filtered out of liveDecision, so it
     cannot be re-announced. The card itself carries the same sentence, and the
     reach-for-proof path (pullEvidence) is unchanged; voice may be MUTED, in
     which case texSpeak is a no-op and the card alone carries the hold.

     The day-one door owns the surface END-TO-END — the threshold, mapping,
     and the spoken count — so a hold arriving behind it stays quiet and
     PENDING: it neither speaks over the manifesto arc (a speak would supersede
     the sequence's epoch and Begin could never settle) nor consumes its one
     announce. The moment the episode ends (door crossed or deferred, count
     spoken and cleared) this re-fires and the hold voices then, over its own
     card, which is already on the glass. */
  useEffect(() => {
    if (state !== "held" || !liveDecision || !alive) return;
    if (!dismissKey) return;
    if (ignitionDoorOpen || mapping || spoken?.kind === "ignite") return;
    if (holding || thinking || verifying) return;
    /* An ANSWER on the glass owns the voice. While one stands (plain or span
       stack) the held card is receded — announcing now would cut the answer's
       audio mid-word AND speak a line whose card isn't visible; during a span
       stack the next span would then cut the announce right back, so the hold
       is consumed audibly unspoken. Defer instead: `answer`/`spanAnswer` are
       deps, so the moment the next reach retires the answer this re-fires and
       the hold voices then, over its own card, which is on the glass again.
       texSpeak still barge-supersedes — that is what makes a NEW hold cut a
       STALE announce — this gate only keeps it from cutting an answer. */
    if (answer || spanAnswer) return;
    if (dismissedRef.current.has(dismissKey)) return;
    if (lastSpokenHeldIdRef.current === dismissKey) return;
    /* The card already receded — voicing it now would speak a line the glass
       no longer shows. Consume the id silently; the queue carries it. */
    if (heldReceded === dismissKey) {
      lastSpokenHeldIdRef.current = dismissKey;
      setAnnouncedKey(dismissKey);
      return;
    }
    /* COUNT-FIRST: while the /held count is on the wire the card holds back,
       and the announce waits WITH it (heldWaiting is a dep) — the voice and
       the glass must speak the same line. Mid-walk the moving frame stays
       quiet too (each seal re-points the wire's freshest hold; announcing
       every step over an operator already deciding is nagging, not
       information) — the id is NOT consumed, so a queue that finishes with
       fresh holds still waiting announces the new count then. */
    if (humanHold && heldWaiting === null) return;
    if (humanHold && heldRows?.length) return;
    const sentence =
      humanHold && heldWaitingCount > 0
        ? heldWaitingLine
        : spokenHeldLine(liveDecision);
    /* Words already spoken this session: a fresh id, but nothing new to say.
       Consume silently — the card renders it; only a different ask voices.
       The announce is settled at once, so the card's linger clock starts. */
    if (spokenHeldSentencesRef.current.has(sentence)) {
      lastSpokenHeldIdRef.current = dismissKey;
      setAnnouncedKey(dismissKey);
      return;
    }
    /* Never barge Tex over Tex: a line is mid-air, so this announce would
       supersede it mid-word — the restart-stutter heard as an echo. Defer
       and retry; the id is NOT consumed, so the announce is deferred, never
       dropped. */
    if (isSpeaking()) {
      if (!announceRetryRef.current) {
        announceRetryRef.current = setTimeout(() => {
          announceRetryRef.current = null;
          setAnnounceTick((t) => t + 1);
        }, ANNOUNCE_RETRY_MS);
      }
      return;
    }
    lastSpokenHeldIdRef.current = dismissKey;
    spokenHeldSentencesRef.current.add(sentence);
    /* The announce SETTLES when its playback ends (texSpeak resolves on the
       natural end, a supersede, or at once when muted) — only then does the
       card's linger clock start, so the voice can never outlive the card. The
       key is captured: by resolution a newer hold may own the glass, and its
       clock must wait for its own announce. */
    const spokenKey = dismissKey;
    texSpeak(sentence).then(() => setAnnouncedKey(spokenKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, dismissKey, alive, holding, thinking, verifying, ignitionDoorOpen, mapping, spoken, answer, spanAnswer, heldReceded, announceTick, humanHold, heldWaiting, heldWaitingCount, heldRows]);
  /* The deferral retry dies with the surface: a pending tick on an unmounted
     Vigil would set state into the void. Re-registration is free — any dep
     change re-evaluates the announce, and a still-busy voice re-arms it. */
  useEffect(
    () => () => {
      if (announceRetryRef.current) {
        clearTimeout(announceRetryRef.current);
        announceRetryRef.current = null;
      }
    },
    []
  );

  /* ---------------- The wordless reach: "Here." ---------------- */
  /* You held the surface and said nothing. Not an error — a check-in.
     Tex answers the reach with one word and returns to silence. Only when
     alive; a dead wire cannot speak, and the still breath already answered. */
  const sayHere = useCallback(() => {
    /* A wordless reach is answered on the glass — one calm "Here." in the voice
       register that rises and, after a short linger, dissolves. VISUAL ONLY:
       texSpeak is deliberately NOT called — the product law is "Tex speaks only
       answers, zero audible filler", so this presence beat is seen, never heard.
       (While a decision is HELD the reach pulls evidence instead; this fires only
       on the truly silent surface — see the reach-release branches.) A dead wire
       cannot answer. */
    if (!alive) return;
    clearLineTimer();
    setSpoken({ kind: "here", text: HERE_LINE });
    lineTimer.current = setTimeout(
      () => morphSurface(() => setSpoken(null)),
      HERE_LINE_MS
    );
  }, [alive]);

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
     anchor rises as the one object the glass may hold; the answer already stays
     put (no dissolve timer), so the proof can be read at leisure. Never
     fabricates an anchor: a claim with no evidence is inert (button disabled). */
  const reachEvidence = useCallback(
    (evidence) => {
      if (!evidence?.value) return;
      setAnswerLeaving(false);
      surfaceObject(evidence.value, evidence.kind);
    },
    [surfaceObject]
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
    /* The door yields to Mapping as ONE substance — never a swap. */
    morphSurface(() => {
      setSpoken(null);
      setMapping(true);
    });

    const started = Date.now();
    /* useIgnition.begin() fires POST /v1/surface/discovery/ignite and returns the
       one spoken line — the count of what the scan actually discovered. That
       single spoken sentence IS the whole Begin reveal: the glass speaks the
       count and returns to silence. Tex does not unfurl an inventory list — a
       roster of rows reads as a dashboard, which the surface refuses to be.

       Begin ignites the SAME estate the vigil watches: the resolved watch
       tenant is threaded through, so the count Tex speaks and the estate the
       surface then reads are one estate — never "ignite default, watch
       tex-enterprise". The keyed sentinel stays off the wire (prod posture:
       the key carries the tenant; scopedTenant already omits the id). */
    const line = await ignition.begin(
      watchTenant && watchTenant !== KEYED_ESTATE ? watchTenant : undefined
    );
    const wait = Math.max(0, MAP_MIN_MS - (Date.now() - started));

    clearMappingTimer();
    mappingTimer.current = setTimeout(() => {
      /* Mapping settles into the spoken count as ONE continuous change. */
      morphSurface(() => {
        setMapping(false);
        if (line) {
          setIgniteWord(-1);
          setSpoken({ kind: "ignite", text: line });
        }
      });
      if (line) {
        clearLineTimer();
        const shownAt = Date.now();
        /* The count is one of the lines the glass HOLDS, so it lights word-by-word
           as Tex voices it (falling back to plain voice if timing is unavailable).
           It clears on the VOICE's clock, not a fixed beat: a fallback safety cap
           is armed now, then onEnd (fired when the voice finishes naturally)
           replaces it with a short read-linger past the final word — so the line
           can never vanish mid-sentence. When the voice is muted/unreachable onEnd
           fires at once, so the read-linger floors at IGNITE_LINE_MS and the line
           still holds a readable beat rather than flashing. Its dissolve is a
           morph too: the count melts into the empty vigil, never blinks out. */
        lineTimer.current = setTimeout(
          () => morphSurface(() => setSpoken(null)),
          IGNITE_LINE_CAP_MS
        );
        texSpeakTimed(line, {
          onWord: (i) => setIgniteWord(i),
          onEnd: () => {
            const remain = Math.max(
              IGNITE_LINE_LINGER_MS,
              IGNITE_LINE_MS - (Date.now() - shownAt)
            );
            clearLineTimer();
            lineTimer.current = setTimeout(
              () => morphSurface(() => setSpoken(null)),
              remain
            );
          },
        });
      }
    }, wait);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ignition, watchTenant]);

  /* Begin is now a gated summons: the press opens the passcode field instead of
     igniting. Focus lands on the field (after it mounts) so the word can be typed
     at once. Never touches ignition — only the right word reaches beginMapping. */
  const openGate = useCallback(() => {
    setPassWrong(false);
    setPassInput("");
    setGateOpen(true);
    requestAnimationFrame(() => passInputRef.current?.focus());
  }, []);

  /* Close the gate without igniting — the operator backed out (Escape / the
     surface going idle). Leaves the Begin act standing, exactly as before. */
  const closeGate = useCallback(() => {
    setGateOpen(false);
    setPassInput("");
    setPassWrong(false);
  }, []);

  /* Verify the word. Right → the gate closes and Begin proceeds EXACTLY as it did
     before (beginMapping runs the real ignite). Wrong → a quiet reject: the field
     shakes, clears, and waits. Trimmed, case-sensitive; no lockout and no attempt
     counter — this is a velvet rope, not a vault (see BEGIN_PASSCODE). */
  const submitPasscode = useCallback(
    (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (passInput.trim() === BEGIN_PASSCODE) {
        setGateOpen(false);
        setPassInput("");
        setPassWrong(false);
        beginMapping();
      } else {
        setPassWrong(true);
        setPassInput("");
        passInputRef.current?.focus();
      }
    },
    [passInput, beginMapping]
  );

  const deferDiscovery = useCallback(() => {
    openHandledRef.current = true; /* rest in silence; Tex does not nag */
    ignition.dismiss();
  }, [ignition]);

  /* ---------------- The ask gesture: press and hold anywhere ---------------- */
  /* The prior Q/A, sent with the next ask so a follow-up ("which one?", "and
     yesterday?") can resolve its references. It steers only the backend's plan
     compiler — every spoken value is still recomputed from sealed rows. */
  const lastExchangeRef = useRef(null);

  /* ---------------- Held decisions, shown WITH their acts ----------------
     "Show me the held decisions" must never end at a sentence: when a turn is
     about holds, the real rows rise under the answer, each carrying the same
     three acts as the held card — a hold you can see is a hold you can
     resolve. Read from GET /v1/surface/discovery/held; a row without a stored
     decision_id (a presence-origin hold) has nothing /seal can resolve yet,
     so it renders as fact, without acts. Epoch-guarded like every other wire:
     a superseded turn's rows never land on the turn that replaced it. */
  /* The fetch itself — shared by the phrasing-gated legacy path below and the
     span answer's explicit HELD act (which reads held-ness from the answer's
     own exhibits, so it must never be re-judged by the words). One discipline
     everywhere: epoch-guarded, seal-dismissed rows filtered, and the rows
     joining the standing answer re-anchor the whole block — a TEX-driven
     layout change, so it morphs like every other one. */
  const surfaceHeldRows = useCallback(() => {
    const myEpoch = askEpochRef.current;
    listHeldDecisions(watchTenant)
      .then((res) => {
        if (myEpoch !== askEpochRef.current) return; /* superseded — stay quiet */
        const rows = (res?.held || []).filter(
          (r) => !(r?.decision_id && dismissedRef.current.has(r.decision_id))
        );
        if (rows.length) morphHeldRows(() => setHeldRows(rows));
      })
      .catch(() => {
        /* Silent. The sentence already told the truth; the rows are depth. */
      });
  }, [watchTenant]);

  /* The span answer's HELD act when the answer carries the EXACT holds it spoke
     (a list_held_waiting exhibit): rise THOSE mapped rows as the resolvable
     queue instead of a second fetch, so the walk shows precisely what was
     voiced. Same queue (HeldRowsList), same seal (resolveHeldRow), same
     discipline as surfaceHeldRows — seal-dismissed rows filtered, the rows join
     the standing answer inside a morph. Synchronous (the rows are already in
     hand from the answer's provenance), so there is no wire and no epoch race to
     guard. */
  const surfaceSpokenHeldRows = useCallback((rows) => {
    const live = (rows || []).filter(
      (r) => !(r?.decision_id && dismissedRef.current.has(r.decision_id))
    );
    if (live.length) morphHeldRows(() => setHeldRows(live));
  }, []);

  const maybeSurfaceHeldRows = useCallback(
    (question, answerText) => {
      if (
        !HELD_ASK_RE.test(question || "") &&
        !HELD_ANSWER_RE.test(answerText || "")
      ) {
        return;
      }
      surfaceHeldRows();
    },
    [surfaceHeldRows]
  );

  /* Resolve one held row by a named human act. The seal is NOT optimistic: the
     card morphs into a calm computing state (the seal screen with no verdict
     assertion and no number) the instant the act is sent, and the seal only
     ASSERTS — the "Sealed." line and the sealed number, scrambled then locked —
     when POST /decisions/{id}/seal returns the REAL anchor (res.anchor_sha256).
     On failure or a silent wire the row is honestly un-resolved: it drops back
     to actionable and re-raises, because it genuinely is still held. Only a
     confirmed seal suppresses the row's wire card for the session. */
  const resolveHeldRow = useCallback((row, verdict) => {
    const id = row?.decision_id;
    if (!id) return;
    /* The decision card MORPHS into its (pending) seal screen (law #2, nothing
       pops). No dismissal yet — the row is not yet resolved; we suppress its
       wire card only once the seal actually lands, so a failed seal re-raises. */
    morphSurface(() =>
      setHeldRows((rows) =>
        rows
          ? rows.map((r) =>
              r.decision_id === id
                ? { ...r, sealedVerdict: verdict, sealedAnchor: null }
                : r
            )
          : rows
      )
    );
    sealDecision(id, { verdict, resolvedBy: TEX_RESOLVER })
      .then((res) => {
        const anchor = res?.anchor_sha256;
        if (!anchor) throw new Error("seal returned no anchor");
        /* Sealed for real — now suppress the wire card and lock the true anchor.
           Capture the seal's provenance too (additively): who the record names as
           resolver and its post-quantum signature, so the walk's seal screen can
           state them beneath the anchor. Legacy responses without these fields
           leave them null and the lines simply don't render. */
        dismissedRef.current.add(id);
        bumpDismissed((n) => n + 1);
        setHeldRows((rows) =>
          rows
            ? rows.map((r) =>
                r.decision_id === id
                  ? {
                      ...r,
                      sealedAnchor: anchor,
                      sealedResolvedBy: res.resolved_by || null,
                      sealedSignature: res.pq_signature || null,
                    }
                  : r
              )
            : rows
        );
      })
      .catch(() => {
        /* The seal never landed — honestly un-resolve: drop the seal screen and
           let the row stand as the held decision it still is. Never leave a
           "Sealed" assertion on the glass over a seal that did not happen. */
        morphSurface(() =>
          setHeldRows((rows) =>
            rows
              ? rows.map((r) =>
                  r.decision_id === id
                    ? { ...r, sealedVerdict: null, sealedAnchor: null }
                    : r
                )
              : rows
          )
        );
      });
  }, []);

  /* COUNT-FIRST — the moment ANY human hold takes the glass (a single
     decision or the wire's aggregate fallback alike), the real queue is read
     from GET /v1/surface/discovery/held. The card then leads with how many
     decisions wait ("N held decisions are waiting for you." + See held
     decisions), never with one decision's card while others hide behind it;
     the walk (HeldRowsList) rises only on the operator's act. Re-read as the
     wire's freshest hold moves (each seal lands a new frame), so the count
     never drifts from the rows the walk will show. Fail-open: a silent /held
     yields an empty list and the card falls back to the single-decision
     presentation the frame itself carries — only rows a seal can resolve
     (decision_id) are counted, so the sentence never promises a walk it
     cannot take. */
  useEffect(() => {
    if (!humanHold) {
      setHeldWaiting(null);
      return undefined;
    }
    let cancelled = false;
    listHeldDecisions(watchTenant)
      .then((res) => {
        if (cancelled) return;
        const rows = (res?.held || []).filter(
          (r) => r?.decision_id && !dismissedRef.current.has(r.decision_id)
        );
        morphSurface(() => setHeldWaiting(rows));
      })
      .catch(() => {
        if (!cancelled) setHeldWaiting([]);
      });
    return () => {
      cancelled = true;
    };
  }, [humanHold, dismissKey, watchTenant]);

  /* The walk finished (every walked row rests on its confirmed seal or its
     keep-holding line) while FRESH decisions the walk never carried are
     waiting — the card returns to the summary, never a stale resting seal
     standing over new holds. The fresh count then announces itself through
     the standing announce effect. */
  useEffect(() => {
    if (!humanHold || !heldRows?.length || !heldWaiting) return;
    const settled = heldRows.every(
      (r) => r.sealedVerdict === "held" || r.sealedAnchor
    );
    if (!settled) return;
    const walked = new Set(heldRows.map((r) => r.decision_id));
    const fresh = heldWaiting.some(
      (r) =>
        !walked.has(r.decision_id) &&
        !dismissedRef.current.has(r.decision_id)
    );
    if (!fresh) return;
    morphSurface(() => setHeldRows(null));
  }, [humanHold, heldRows, heldWaiting]);

  /* The clean slate — the ONE ask the surface answers itself, never the
     backend: "refresh" (or "clear", "new topic", …) wipes the trail, the
     standing answer, and the follow-up context, and lets any ask still in
     flight die stale. The next question starts a fresh topic. It touches
     NOTHING that waits for a human seal — a held decision stays held. */
  const refreshSurface = useCallback(() => {
    askEpochRef.current += 1;
    /* Clean slate: let any ask in flight die stale AND stop it on the wire. */
    abortAsk();
    clearLineTimer();
    /* The presence-beat wedge-guard (see beginHold): the "Here." and ignite
       count dissolves ride the lineTimer cleared above, so a refresh must
       clear the beats themselves too. */
    setSpoken((s) => (s && (s.kind === "here" || s.kind === "ignite") ? null : s));
    clearObjectTimer();
    setSurfaced(null);
    setSealed(null);
    clearAnswer();
    setTrail([]);
    lastExchangeRef.current = null;
    stopSpeaking();
    setThinking(false);
    setVerifying(false);
    setHeard("");
  }, [clearAnswer, abortAsk]);

  const listenerRef = useRef(null);
  /* The browser's own speech recognizer — the real hold-to-speak. Separate from
     the muted voice gateway (TexListener) so a question can be heard without
     standing up the gateway. */
  const seeListenerRef = useRef(null);

  /* The live gesture's anchor: which pointer opened the hold (null for the
     keyboard reach) and whether a hold is live RIGHT NOW — refs, not state,
     so the pointer handlers never read a stale closure. Only the pointer
     that opened the mic may close (or cancel) it. */
  const holdPointerRef = useRef(null);
  const holdActiveRef = useRef(false);

  /* The speculative bet's AUDIO twin: when a bet resolves while it is still
     the LIVE bet (mid-hold, or inside the release's finalize window), warm the
     answer's timed clip through the voice engine's prefetch slot. A pure
     fetch — nothing sounds, no epoch moves; only texSpeakSynced can voice it,
     and only when the redeemed answer matches exactly (text + prosody token).
     On the common redeemed path Tex's voice then starts from LOCAL audio at
     the release instead of paying the TTS round trip. A bet that was already
     redeemed (specRef nulled at redemption) or replaced by a newer bet warms
     nothing — no wasted fetch; a warm that is never spoken is aborted by the
     next speak's supersede and can never sound. */
  const armAnswerPrewarm = useCallback((p) => {
    const betEpoch = askEpochRef.current;
    p.then((res) => {
      if (betEpoch !== askEpochRef.current) return; /* turn superseded */
      if (!specRef.current || specRef.current.promise !== p) return; /* redeemed or re-bet */
      const presence = derivePresence(res);
      if (presence?.spokenText) prewarmSpeak(presence.spokenText, presence.prosodyToken);
    }).catch(() => {});
  }, []);

  /* Every live partial while the mic is held: feed the heard line (the words
     form on the glass AS they are spoken) and arm the SPECULATIVE ask — once a
     partial holds stable for SPECULATE_STABLE_MS, /v1/ask fires early so the
     answer is often already sealed when the release lands. One bet in flight
     at a time; a changed partial re-bets and the old bet is ABORTED — read-only
     on the browser side, but left running it would hold the single-worker
     backend and delay the TTS fetch behind it (the choppy-voice RCA). */
  const onAskPartial = useCallback(
    (t) => {
      setHeard(t);
      if (specTimerRef.current) clearTimeout(specTimerRef.current);
      specTimerRef.current = setTimeout(() => {
        const q = normalizeAsk(t);
        /* Too little to bet on: a fragment with no second word yet. And a
           clean-slate verb is the surface's own turn — never a backend bet. */
        if (q.length < 8 || q.indexOf(" ") < 0) return;
        if (isRefreshCommand(t)) return;
        if (specRef.current && specRef.current.q === q) return;
        /* A changed partial re-bets: the old bet is dead the moment the words
           moved, so abort its wire — otherwise every re-stabilized partial
           stacks another full ask on the single worker. */
        abandonBet();
        const ctrl = new AbortController();
        const p = askTex(t, watchTenant, lastExchangeRef.current, ctrl.signal);
        /* Silence an ABANDONED bet's rejection (including its AbortError); a
           REDEEMED bet gets the real .then/.catch handlers at release. */
        p.catch(() => {});
        specRef.current = { q, promise: p, ctrl };
        armAnswerPrewarm(p);
      }, SPECULATE_STABLE_MS);
    },
    [watchTenant, armAnswerPrewarm]
  );

  const beginHold = useCallback(
    (e) => {
      /* One gesture at a time, and only the PRIMARY pointer's main button may
         open the mic: a right-click belongs to the browser, a second finger
         belongs to the finger already holding. (No event = the keyboard
         reach — always allowed.) */
      if (holdActiveRef.current) return;
      if (e && e.pointerType != null) {
        if (e.isPrimary === false) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
      }
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
      /* A press on ANY interactive control — a decision act, the proof / held
         pill, the passcode field, Begin, the typed line — is that control's
         press. Return BEFORE the teardown below (clearLineTimer, setSealed,
         retireAnswer, setSurfaced) so the answer the pill sits on survives the
         click and the mic never opens under it. The global guard, not per-button
         stopPropagation, is the real fix — every control added later is safe by
         being a button / [data-act]. */
      if (hitsInteractive(e)) {
        return;
      }
      /* The ask gesture is inert until the day-one threshold is resolved and
         closed, and while mapping runs. There is nothing sealed to ask about
         before discovery has begun, and holding must not open a mic over the
         greeting or the count. */
      if (!ignitionReady || ignitionDoorOpen || mapping) return;

      clearLineTimer();
      /* A new reach takes the surface: a lingering seal yields NOW. Without
         this, clearing lineTimer above orphans the seal's dissolve — the only
         path that ever cleared `sealed` — and the card wedges on the glass,
         blinding every later answer (they all render behind `!sealed`). */
      setSealed(null);
      /* The same wedge-guard for the timer-owned presence beats — "Here." and
         the day-one ignite count: each one's dissolve is the ONLY thing that
         clears it, and both ride the lineTimer cleared above — a press inside
         that window would otherwise wedge the stale line on the glass forever
         if the gesture is later cancelled (a stranded ignite line also hides
         the held card and suppresses its announce). Clearing the count's
         VISUAL here is consistent, not a cut: stopSpeaking() below already
         ends its voice. */
      setSpoken((s) => (s && (s.kind === "here" || s.kind === "ignite") ? null : s));
      clearObjectTimer();
      setSurfaced(null);
      retireAnswer();
      stopSpeaking();
      setThinking(false);
      setVerifying(false);
      setHeard("");
      /* Supersede any ask still in flight: this press owns the surface now. */
      askEpochRef.current += 1;
      /* A voice reach also cancels a pending TYPED ask on the wire, so its
         answer can't queue TTS behind this press. */
      abortAsk();
      /* A fresh hold is a fresh turn: no bet from a previous gesture may leak
         into this one — and none may keep running server-side either. */
      abandonBet();
      if (specTimerRef.current) {
        clearTimeout(specTimerRef.current);
        specTimerRef.current = null;
      }

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
      /* Anchor the gesture: only this pointer (or the keyboard, null) may
         end or cancel it. */
      holdPointerRef.current = e && e.pointerId != null ? e.pointerId : null;
      holdActiveRef.current = true;
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
        /* The live partial feeds the heard line (never speak blind) AND the
           speculative ask (the answer races the release). */
        see.start(onAskPartial).catch(() => {
          seeListenerRef.current = null;
        });
      } else {
        const listener = new TexListener();
        listenerRef.current = listener;
        listener.start(onAskPartial).catch(() => {
          listenerRef.current = null;
        });
      }
    },
    [state, liveDecision, snapshot, ignitionReady, ignitionDoorOpen, mapping, awake, onThreshold, retireAnswer, onAskPartial, abortAsk]
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

  const endHold = useCallback((e) => {
    if (!holding) return;
    /* Only the pointer that opened the mic may close it — a second finger's
       lift must not end the first finger's turn. (No event = the keyboard.) */
    if (
      e &&
      e.pointerId != null &&
      holdPointerRef.current != null &&
      e.pointerId !== holdPointerRef.current
    ) {
      return;
    }
    holdPointerRef.current = null;
    holdActiveRef.current = false;
    /* The gesture guard (holdActiveRef) is released instantly above; the visible
       `holding` state — the listening orb — clears one beat later, INSIDE the
       release morph, so the orb dissolves into the deliberation mark (Tex taking
       the floor) instead of hard-snapping to nothing. The no-recognizer path
       below has no mark to rise into, so it clears the orb plainly. */

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

    /* The epoch this release was born under — if a newer reach takes the
       surface while this one's wire is in flight, everything below goes
       quiet instead of surfacing a superseded answer over the new turn. */
    const myEpoch = askEpochRef.current;

    /* No recognizer opened (unsupported / denied). The gesture still happened,
       so a silent reach is answered and a held reach pulls the proof. */
    if (!capture) {
      setHolding(false); /* no mark to rise into — retire the orb plainly */
      if (reachInHeld) pullEvidence(liveDecision);
      else if (reachInSilence) sayHere();
      return;
    }

    /* Release-instant second bet: when no stable partial got a bet in (a
       short question, or a last-moment revision), fire the ask NOW with the
       fullest transcript already in memory, in parallel with the
       recognizer's finalization — the finalize window then costs nothing
       whenever the words don't change. Redeemed below iff the FINAL
       transcript normalizes identically; a mismatch falls back to the
       fresh ask, exactly like the stable-partial bet. */
    if (see && !specRef.current && typeof see._result === "function") {
      const early = see._result();
      const q = normalizeAsk(early);
      if (q.length >= 8 && q.indexOf(" ") > 0 && !isRefreshCommand(early)) {
        const ctrl = new AbortController();
        const p = askTex(early, watchTenant, lastExchangeRef.current, ctrl.signal);
        p.catch(() => {});
        specRef.current = { q, promise: p, ctrl };
        /* The finalize window (up to 1600ms) is exactly the time this warm
           needs — if the words don't change, the answer's audio is local by
           the time the redemption speaks it. */
        armAnswerPrewarm(p);
      }
    }

    /* The floor changes hands: the listening orb retires and the deliberation
       mark rises in ONE crossfade (--tex-t4), not two un-cross-faded motions at
       the instant of release. Both flags flip inside the same morph callback so
       there is no frame where the orb has snapped away before the mark arrives.
       Reduced motion / no-VT falls back to an instant apply, as everywhere. */
    morphSurface(() => {
      setHolding(false);
      setThinking(true);
    });
    capture
      .stop()
      .then((transcript) => {
        /* Superseded while finalizing (a quick re-press during the grace
           window): this turn is over; the new gesture owns every flag. */
        if (myEpoch !== askEpochRef.current) return undefined;
        setThinking(false);
        if (!transcript) {
          setHeard("");
          if (reachInHeld) pullEvidence(liveDecision);
          else if (reachInSilence) sayHere();
          return undefined;
        }
        /* Settle the heard line to the FINAL transcript — the line the ask
           actually carries. Any late recognizer revision lands here, the same
           retro-correction settle the live-transcript pattern expects. */
        setHeard(transcript);
        /* The clean-slate verb is the surface's own turn, never a backend
           question: "refresh" wipes the trail and the topic, silently. */
        if (isRefreshCommand(transcript)) {
          /* No bet outlives a clean slate — on the wire either. */
          abandonBet();
          if (specTimerRef.current) {
            clearTimeout(specTimerRef.current);
            specTimerRef.current = null;
          }
          refreshSurface();
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
        /* Redeem the speculative bet when it matches the FINAL transcript —
           the ask fired while the operator was still speaking, so its answer
           is often already sealed and the verifying beat is a blink. A
           mismatch (the recognizer revised the words) falls back to a fresh
           ask of exactly what was finally heard — correctness over speed. */
        const spec = specRef.current;
        specRef.current = null;
        if (specTimerRef.current) {
          clearTimeout(specTimerRef.current);
          specTimerRef.current = null;
        }
        const redeemed = spec && spec.q === normalizeAsk(transcript);
        /* A mismatched bet is abandoned work: abort it BEFORE the fresh ask
           fires, so the real question isn't queued on the single worker
           behind an answer to words the recognizer revised away. */
        if (spec && !redeemed) spec.ctrl.abort();
        /* The live ask's cancel handle — the redeemed bet keeps its own
           controller, a fresh ask mints one. Aborted below iff the span
           pipeline wins the glass and this answer would go unread. */
        const askCtrl = redeemed ? spec.ctrl : new AbortController();
        const askPromise = redeemed
          ? spec.promise
          : askTex(transcript, watchTenant, lastExchangeRef.current, askCtrl.signal);
        const finishLegacy = () =>
          askPromise.then((res) => {
            if (myEpoch !== askEpochRef.current) return; /* superseded — stay quiet */
            /* verifying clears INSIDE surfaceAnswer's morph — clearing it here
               would pop the deliberation mark out a frame before the snapshot. */
            /* Backend decides, frontend renders: derivePresence only NORMALIZES the
               wire (the presence envelope when present, the AskResponse otherwise).
               The credibility tier it carries is the gate's real verdict, never a
               confidence the UI invented. */
            const presence = derivePresence(res);
            if (presence?.spokenText) {
              /* Meaning is spoken — and surfaced with its tier and any claims,
                 staying on the glass until the next reach. If the answer's target
                 is an object you must carry away (a hash, an exact name), that
                 handle also surfaces. */
              lastExchangeRef.current = {
                prior_question: transcript,
                prior_answer: presence.spokenText,
              };
              surfaceAnswer(presence, transcript);
              /* A turn about holds surfaces the queue itself, resolvable. */
              maybeSurfaceHeldRows(transcript, presence.spokenText);
              if (presence.object?.value) {
                surfaceObject(presence.object.value, presence.object.kind);
              }
            } else {
              /* A transcribed question that came back empty is NOT silence —
                 say so, honestly, as an abstain-tier line. */
              surfaceFailure("The records returned nothing for that.", transcript);
            }
          });
        /* SPANS: the voice reach asks the sealed pipeline FIRST, exactly like
           the typed line. A usable span answer takes the glass and speaks with
           per-span prosody; any fault (route absent, error, no spans) falls
           back to the proven legacy round-trip above — whose speculative bet
           is still warm, so the fallback pays no extra latency. The bet's
           promise gets a no-op catch on the span path so a failed speculative
           ask can never surface as an unhandled rejection. */
        if (SPANS_ENABLED) {
          return askAnswer(transcript, watchTenant, lastExchangeRef.current)
            .then((res) => {
              if (myEpoch !== askEpochRef.current) return; /* superseded */
              if (res && Array.isArray(res.spans) && res.spans.length) {
                /* Spans took the glass: the legacy ask is the LOSER of the
                   race. Silence it, then abort it — discarded-but-running
                   was half the stacked load on the single worker. */
                askPromise.catch(() => {});
                askCtrl.abort();
                lastExchangeRef.current = {
                  prior_question: transcript,
                  prior_answer: res.spoken_text || "",
                };
                surfaceSpanAnswer(res, transcript);
                /* A span answer about holds carries its own HELD act (the
                   chip under the span stack) — the queue rises on an explicit
                   press, never auto-surfaced over the spoken answer. */
                return;
              }
              return finishLegacy();
            })
            .catch(() => {
              if (myEpoch !== askEpochRef.current) return; /* superseded */
              return finishLegacy();
            });
        }
        return finishLegacy();
      })
      .catch(() => {
        if (myEpoch !== askEpochRef.current) return; /* superseded — stay quiet */
        /* Never-silent: a failed round-trip (backend down, cold start, 4xx/5xx)
           must not be indistinguishable from "no data". The failure line IS a
           surfaceAnswer, so thinking/verifying clear inside its morph. */
        surfaceFailure("I can't reach the records right now.");
      });
  }, [holding, state, alive, sayHere, surfaceObject, pullEvidence, liveDecision, surfaceAnswer, surfaceFailure, maybeSurfaceHeldRows, refreshSurface, watchTenant, armAnswerPrewarm]);

  /* A CANCELLED gesture is not a release. The OS stole the pointer (an
     incoming call, an edge-swipe, palm rejection) or the hold lost its window
     or tab mid-press — nothing was asked. Stop the recognizer, DISCARD what
     it heard, return to silence. Release means intent; cancel means nothing
     happened. */
  const cancelHold = useCallback((e) => {
    if (!holdActiveRef.current) return;
    if (
      e &&
      e.pointerId != null &&
      holdPointerRef.current != null &&
      e.pointerId !== holdPointerRef.current
    ) {
      return;
    }
    holdPointerRef.current = null;
    holdActiveRef.current = false;
    /* No bet survives a cancelled turn — on the wire either. */
    askEpochRef.current += 1;
    abandonBet();
    if (specTimerRef.current) {
      clearTimeout(specTimerRef.current);
      specTimerRef.current = null;
    }
    const see = seeListenerRef.current;
    seeListenerRef.current = null;
    const listener = listenerRef.current;
    listenerRef.current = null;
    if (see) see.stop().catch(() => {}); /* transcript deliberately dropped */
    if (listener) {
      try { listener.stop(); } catch { /* ignore */ }
    }
    setHolding(false);
    setHeard("");
    setThinking(false);
  }, []);

  /* A hold that loses its window or its tab cancels to silence — Cmd-Tab, an
     OS dialog, a focus steal mid-press must never leave a hot mic pulsing in
     the background. The pointer path is anchored by capture; this is the same
     guarantee for the keyboard hold and for true app-level loss. */
  useEffect(() => {
    if (!holding) return undefined;
    const lost = () => cancelHold();
    const onVis = () => {
      if (document.hidden) lost();
    };
    window.addEventListener("blur", lost);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", lost);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [holding, cancelHold]);

  /* Escape — the one key that means only "stop": silence the voice, clear the
     glass (answer, trail, object, a lingering seal), discard a live hold, and
     let any in-flight ask die stale. The keyboard twin of the spoken
     "refresh". It touches NOTHING that waits for a human seal — a held
     decision stays exactly where it is. */
  const quiet = useCallback(() => {
    if (holdActiveRef.current) cancelHold();
    refreshSurface();
  }, [refreshSurface, cancelHold]);

  /* Registered at the document so Escape works whether focus sits on the
     field, the body, or nowhere at all. The typed line's own Escape handler
     stops propagation before this ever hears it; the day-one arc keeps its
     own rhythm (no skipping the door). */
  useEffect(() => {
    const onEsc = (e) => {
      if (e.key !== "Escape") return;
      if (!ignitionReady || ignitionDoorOpen || mapping) return;
      quiet();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [ignitionReady, ignitionDoorOpen, mapping, quiet]);

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

  /* ---------------- TYPE TO WRITE — the surface acts ----------------
     The composing line itself lives in the memoized <TypedLine> leaf (so a
     keystroke never reconciles this monolith). Vigil keeps only the two surface
     ACTS a typed reach performs — clearing the glass when a line begins, and the
     grounded round-trip when it is submitted — handed down to the leaf as props. */

  /* The surface-clear a typed reach performs when it BEGINS — the same wedge-guard
     beginHold carries: the object, a lingering seal, and any ask still in flight
     all yield to the new question. (The voice-unlock and roster/aid load live in
     the leaf, off this render, so priming them never re-renders the monolith.) */
  const onTypingBegin = useCallback(() => {
    askEpochRef.current += 1;
    /* This new line owns the surface: cancel any ask still on the wire so it
       stops loading the single worker (the epoch already voids its answer). */
    abortAsk();
    clearLineTimer();
    setSealed(null);
    /* The presence-beat wedge-guard, exactly as in beginHold: the "Here." and
       ignite-count dissolves ride the lineTimer cleared above. */
    setSpoken((s) => (s && (s.kind === "here" || s.kind === "ignite") ? null : s));
    clearObjectTimer();
    setSurfaced(null);
    retireAnswer();
    stopSpeaking();
    setHeard("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retireAnswer, abortAsk]);

  /* Submit the typed question — the SAME grounded round-trip the voice reach runs
     (playPresenceAck → /v1/ask → derivePresence → surfaceAnswer), then dissolve.
     The leaf hands up the final line (its words + any accepted ghost, in the
     agent's true casing) and has already dissolved its own state.
     (Duplicates the voice path's ~6-line answer flow on purpose, so the proven
     endHold stays byte-identical while typing is behind a flag; DRY once shipped.) */
  const onTypingSubmit = useCallback((q) => {
    if (!q) return;
    /* The clean-slate verb is the surface's own turn, never a backend
       question: a typed "refresh" wipes the trail and the topic, silently. */
    if (isRefreshCommand(q)) {
      refreshSurface();
      return;
    }
    playPresenceAck();
    setVerifying(true);
    /* Latest-wins: if another reach takes the surface while this question is
       on the wire, its answer dies stale instead of surfacing (see endHold). */
    const myEpoch = askEpochRef.current;
    /* Mirror the voice path: mint a cancel handle for THIS ask (replacing any
       prior one, which onTypingBegin already aborted) so a superseding reach can
       actually stop the request, not just void its answer. */
    abortAsk();
    const askCtrl = new AbortController();
    askAbortRef.current = askCtrl;

    /* The proven voice/typed round-trip, unchanged — extracted so the span
       pipeline can fall back to it verbatim (byte-identical flow) when
       /v1/answer is not mounted yet, and so a flag-off build runs exactly this. */
    const runAskTex = () =>
      askTex(q, watchTenant, lastExchangeRef.current, askCtrl.signal)
        .then((res) => {
          if (myEpoch !== askEpochRef.current) return; /* superseded — stay quiet */
          /* verifying clears inside surfaceAnswer's morph (see endHold). */
          const presence = derivePresence(res);
          if (presence?.spokenText) {
            lastExchangeRef.current = {
              prior_question: q,
              prior_answer: presence.spokenText,
            };
            surfaceAnswer(presence, q);
            /* A turn about holds surfaces the queue itself, resolvable. */
            maybeSurfaceHeldRows(q, presence.spokenText);
            if (presence.object?.value) {
              surfaceObject(presence.object.value, presence.object.kind);
            }
          } else {
            surfaceFailure("The records returned nothing for that.", q);
          }
        })
        .catch(() => {
          if (myEpoch !== askEpochRef.current) return; /* superseded — stay quiet */
          surfaceFailure("I can't reach the records right now.", q);
        });

    /* FLUID-TRUTH first when VITE_TEX_SPANS is on: ask POST /v1/answer for a
       span answer. If the route is not mounted yet (404/501) fall back SILENTLY
       to the proven askTex path — the operator sees a normal answer, never an
       error. Any OTHER failure (a real network fault) also falls back to askTex,
       whose own catch surfaces an honest abstain-tier line, so a broken span
       route can never leave the surface silent. With the flag OFF this branch is
       dead and runAskTex is the whole path — byte-identical to before. */
    if (SPANS_ENABLED) {
      askAnswer(q, watchTenant, lastExchangeRef.current, askCtrl.signal)
        .then((res) => {
          if (myEpoch !== askEpochRef.current) return; /* superseded — stay quiet */
          const spans = Array.isArray(res?.spans) ? res.spans : [];
          if (!spans.length) {
            /* A mounted route that returned no spans — degrade to the plain path
               rather than showing an empty stack. */
            runAskTex();
            return;
          }
          /* Carry the span answer into the follow-up context so a "which one?"
             can still resolve its references off the spoken concatenation. */
          lastExchangeRef.current = {
            prior_question: q,
            prior_answer: res?.spoken_text || spans.map((s) => s?.text || "").join(" "),
          };
          surfaceSpanAnswer(res, q);
        })
        .catch((err) => {
          if (myEpoch !== askEpochRef.current) return; /* superseded — stay quiet */
          /* 404/501 = route not mounted yet; any other error = a real fault.
             Both fall back to askTex, which surfaces an honest line on failure. */
          if (!isRouteAbsent(err)) {
            /* a real span-route fault — still never silent: askTex takes over. */
          }
          runAskTex();
        });
      return;
    }

    runAskTex();
  }, [refreshSurface, watchTenant, surfaceAnswer, surfaceSpanAnswer, surfaceFailure, surfaceObject, maybeSurfaceHeldRows, abortAsk]);

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
      /* The seal owns the glass now — an ask still in flight from before the
         act must not surface over it. (setSpoken and the dismissal live
         INSIDE the morphs below: any state flush before the snapshot removes
         the card from the "old" frame and the morph crossfades a blank.) */
      askEpochRef.current += 1;

      /* The calibration hold resolves through the learning layer, not /seal:
         approving/rejecting a proposal IS its sealed act. */
      if (isCalibration(decision)) {
        const proposalId = decision.hold?.proposal_id;
        const fromWire = Boolean(humanDecisionLive);

        /* The held card yields to the seal as one substance, and the seal
           later melts back to silence — morphs, never swaps. Card-out and
           seal-in are ONE flushed update between the two snapshots: the
           dismissal (bumpDismissed flushes a render) must not land first,
           or the old frame has already lost the card and the morph
           crossfades a blank surface into the seal. */
        morphSurface(() => {
          setSpoken(null);
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
        });
        clearLineTimer();
        lineTimer.current = setTimeout(
          () => morphSurface(() => setSealed(null)),
          4_200
        );

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

      /* A held DECISION is sealed by a named human act (POST /seal). The seal is
         NOT asserted optimistically: the card morphs to a calm computing state
         (pending — no "sealed" word, no number) and only becomes a sealed seal,
         with the true anchor, when /seal returns it. So the wire card is NOT
         suppressed up front — a failed seal must re-raise the held card, because
         the decision genuinely stays held. */
      /* Held → seal(pending) as one substance. The keep-holding branch is a local
         state, not a backend seal, so it asserts nothing false and can melt to
         silence on its own beat below. */
      const isSealVerdict = verdict === "approved" || verdict === "refused";
      morphSurface(() => {
        setSpoken(null);
        setSealed({
          verdict,
          at: new Date(),
          anchor: null,
          signature: null,
          /* Pending only while a real decision is out for sealing; a keep-holding
             (or an id-less hold) has nothing on the wire, so it is not pending. */
          pending: Boolean(decision?.id) && isSealVerdict,
        });
      });

      if (decision?.id && isSealVerdict) {
        /* No melt-to-silence timer yet: the seal stays computing on the glass
           until the wire answers, so the surface never dissolves a pending seal
           into silence (which would read as a completed act). */
        sealDecision(decision.id, { verdict, resolvedBy: TEX_RESOLVER })
          .then((res) => {
            const anchor = res?.anchor_sha256;
            if (!anchor) throw new Error("seal returned no anchor");
            /* Sealed for real — NOW suppress the wire card and lock the true
               anchor, then rest a beat and melt to silence. */
            dismissedRef.current.add(decision.id);
            bumpDismissed((n) => n + 1);
            setSealed((prev) =>
              prev
                ? {
                    ...prev,
                    anchor,
                    signature: res.pq_signature || null,
                    at: res.sealed_at ? new Date(res.sealed_at) : prev.at,
                    pending: false,
                  }
                : prev
            );
            clearLineTimer();
            lineTimer.current = setTimeout(
              () => morphSurface(() => setSealed(null)),
              6_000
            );
          })
          .catch(() => {
            /* The seal never landed — honestly un-resolve: melt the computing
               seal back to silence and leave the held card to re-raise on the
               next wire frame (it was never dismissed). Never leave a "sealed"
               assertion over a seal that did not happen. */
            morphSurface(() => setSealed(null));
          });
      } else {
        /* Keep-holding (or an id-less hold): a local, honest "held" beat, then
           back to silence. */
        clearLineTimer();
        lineTimer.current = setTimeout(
          () => morphSurface(() => setSealed(null)),
          4_200
        );
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
      if (listenerRef.current) {
        try { listenerRef.current.stop(); } catch { /* ignore */ }
        listenerRef.current = null;
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
    window.__texPresence = (raw, { verifyMs = 1100, question } = {}) => {
      ignition.dismiss(); /* cross the day-one door into the live surface */
      stopSpeaking();
      retireAnswer(); /* the standing turn recedes into the trail, as live */
      clearObjectTimer();
      setSurfaced(null);
      setSpoken(null);
      setVerifying(true);
      setTimeout(() => {
        const presence = derivePresence(raw);
        if (presence?.spokenText) {
          /* verifying clears inside surfaceAnswer's morph, as live. */
          surfaceAnswer(presence, question || null);
          if (presence.object?.value) {
            surfaceObject(presence.object.value, presence.object.kind);
          }
        } else {
          setVerifying(false); /* nothing to surface — release the beat */
        }
      }, verifyMs);
    };
    /* Hold just the deliberation pause open, for screenshotting that beat. */
    window.__texVerifying = (on = true) => setVerifying(Boolean(on));
    /* Rise a held-rows list under the standing answer (the /held wire shape),
       and the clean-slate verb — browser-verification twins of the real paths. */
    window.__texHeldRows = (rows) => setHeldRows(rows && rows.length ? rows : null);
    window.__texRefresh = () => refreshSurface();
    return () => {
      try {
        delete window.__texPresence;
        delete window.__texVerifying;
        delete window.__texHeldRows;
        delete window.__texRefresh;
      } catch { /* ignore */ }
    };
  }, [ignition, surfaceAnswer, surfaceObject, retireAnswer, refreshSurface]);

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
      /* keystroke→paint sample: time a real value-set + input → next paint.
         The composing input lives in the <TypedLine> leaf now — query it. */
      const el = document.querySelector(".tex-line");
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

  const decision = liveDecision;

  /* Which presentation the held card leads with. Calibration proposals keep
     their own card ("card"). A human hold is COUNT-FIRST: "pending" holds the
     card back the beat the /held count is on the wire (silence, never a
     flash); "summary" is the return posture — the count line + See held
     decisions; "queue" is the walk itself (HeldRowsList), risen by the act or
     already mid-walk; "card" is the fallback when /held could not speak —
     the single-decision card the frame itself carries, exactly as before.

     A MOUNTED walk owns the surface first, ABOVE the humanHold gate: sealing
     the walk's last (or only) row optimistically dismisses that decision id,
     which flips humanHold false — a multi-row walk survives because its
     aggregate hold isn't the dismissed id, but a single-row walk would
     collapse to "card" mid-seal and tear the seal ceremony (anchor lock,
     provenance lines) off the glass before it renders. Keeping "queue" while
     heldRows is non-null lets the walk finish and rest on its final seal
     exactly as the multi-row walk already does; the walk clears its own
     heldRows (settled + fresh holds → summary), so this never strands a
     stale queue over new work. */
  const heldMode = heldRows?.length
    ? "queue"
    : !humanHold
    ? "card"
    : heldWaiting === null
    ? "pending"
    : heldWaitingCount > 0
    ? "summary"
    : "card";

  /* The day-one door owns the surface until it is crossed — the session-scoped
     threshold, deferring to a faltering chain (you don't greet over a broken
     witness) and yielding to the mapping state the instant Begin is pressed. */
  const doorOpen =
    ignition.ready &&
    ignition.doorOpen &&
    state !== "faltering" &&
    !mapping;

  /* A choice rests with the human. Whenever a pressable decision is on the
     glass — Begin at the door, the held card's acts, an unresolved held row —
     the field breathes the same cold pallor as faltering until the choice is
     taken: the weight sits in the surface itself, never a badge or a spinner. */
  const deciding =
    (doorOpen && awake && manifestoDone) ||
    /* The held card breathes only when it carries a pressable act — the
       count-first summary's See held decisions counts (a choice waits behind
       it); the pending beat and the actless fallback (no id, no proposal)
       do not. */
    (!doorOpen &&
      !mapping &&
      state === "held" &&
      Boolean(
        isCalibration(decision) ||
          heldMode === "summary" ||
          (heldMode === "card" && decision?.id)
      ) &&
      !sealed) ||
    Boolean(heldRows?.some((row) => row.decision_id && !row.sealedVerdict));

  const fieldClass = useMemo(() => {
    const base = "tex-field";
    const s = `tex-field--${state}`;
    const listening = holding ? " is-listening" : "";
    const think = thinking ? " is-thinking" : "";
    const lost = !alive ? " is-lost" : "";
    const decide = deciding ? " is-deciding" : "";
    return `${base} ${s}${listening}${think}${lost}${decide}`;
  }, [state, holding, thinking, alive, deciding]);

  /* The EXACT holds the standing span answer SPOKE — mapped to the walker's row
     shape and ordered newest-first — recomputed only when the span answer
     changes. Empty for any answer without a list_held_waiting exhibit, which
     keeps count-only and sink-sourced flows on today's behavior. */
  const spanSpokenHeld = useMemo(
    () => (spanAnswer ? spanAnswerHeldWaiting(spanAnswer.res) : []),
    [spanAnswer]
  );

  /* ---------------- RETURN TO SILENCE — idle-to-blank ----------------
     Silence is Tex's resting state. When no hand is on the glass and nothing
     is being asked for IDLE_BLANK_MS, the surface dissolves back to empty white
     through the same clean slate Escape uses (quiet → refreshSurface), wrapped
     in the one-material morph so the words EXHALE out rather than pop.

     The hard rule lives in `idleBlocked`: this fade may NEVER take the surface
     while a decision waits for a human seal (`deciding` — the held card, an
     unresolved held row, Begin at the door), never during the day-one arc, and
     never across Tex mid-answer or a hand mid-hold. When approval is needed, the
     surface stays; only a truly at-rest glass is allowed to find its way back to
     blank. A half-formed typed line is treated as intent and is left untouched. */
  const idleActivityRef = useRef(0);
  const quietRef = useRef(quiet);
  quietRef.current = quiet;

  /* The at-rest whisper (REST_HINT_MS). It rides the SAME plumbing as the
     return-to-blank above — one set of activity listeners, one interval — never a
     second timer system. `restClockRef` is the "silent since" stamp: reset on any
     activity and whenever the surface is not eligible, left to accumulate only
     while the glass sits truly bare. The ref mirrors the boolean so `mark` (which
     fires on every pointer move) can hide the whisper without a re-render unless
     it was actually showing. */
  const [restHint, setRestHint] = useState(false);
  const restHintRef = useRef(false);
  const restClockRef = useRef(0);

  /* Refreshed every render so the mount-scoped watcher never reads stale state.
     A plain ref write (no re-render) — the interval below reads .current. */
  const idleBlocked =
    deciding ||
    !ignitionReady ||
    ignitionDoorOpen ||
    mapping ||
    holding ||
    thinking ||
    verifying ||
    isTyping;
  const idleHasContent =
    trail.length > 0 ||
    Boolean(answer) ||
    Boolean(spoken) ||
    Boolean(surfaced) ||
    Boolean(sealed) ||
    heard.length > 0;
  const idleGuardRef = useRef(null);
  idleGuardRef.current = {
    blocked: idleBlocked,
    hasContent: idleHasContent,
    alive,
  };

  useEffect(() => {
    /* Any real reach keeps Tex present; only true absence lets it fade. Cheap
       ref writes, no re-render, captured so a stopPropagation upstream can't
       hide the operator's presence from the clock. */
    const mark = () => {
      idleActivityRef.current = Date.now();
      /* Any activity resets the whisper's silence-clock and dissolves it a rung
         faster (CSS handles the fade) — but only touch state when it was actually
         showing, so a pointermove storm never re-renders. */
      restClockRef.current = Date.now();
      if (restHintRef.current) {
        restHintRef.current = false;
        setRestHint(false);
      }
    };
    mark();
    const opts = { passive: true, capture: true };
    const evs = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
    evs.forEach((e) => document.addEventListener(e, mark, opts));

    const tick = setInterval(() => {
      const g = idleGuardRef.current;
      const hidden = document.hidden;

      /* The at-rest whisper is eligible only on a truly silent, empty, living
         surface — the exact INVERSE of the return-to-blank surface (which needs
         content to fade), so the two can never fire on the same frame. While
         ineligible, hold its clock at "now" and make sure it is hidden; while
         eligible, let the clock run and reveal the hint once it crosses the
         threshold. */
      const restEligible =
        Boolean(g) && !g.blocked && !g.hasContent && g.alive && !hidden;
      if (!restEligible) {
        restClockRef.current = Date.now();
        if (restHintRef.current) {
          restHintRef.current = false;
          setRestHint(false);
        }
      } else if (
        !restHintRef.current &&
        Date.now() - restClockRef.current >= REST_HINT_MS
      ) {
        restHintRef.current = true;
        setRestHint(true);
      }

      /* Not eligible right now (a choice waits, the door is open, Tex is mid
         work, the tab is hidden, or the glass is already bare): hold the clock
         at "now" so the countdown starts fresh the instant the surface is once
         again at rest with something on it — never fires stale mid-resolution. */
      if (!g || g.blocked || !g.hasContent || hidden) {
        idleActivityRef.current = Date.now();
        return;
      }
      if (Date.now() - idleActivityRef.current >= IDLE_BLANK_MS) {
        idleActivityRef.current = Date.now();
        /* Tex-driven return to rest → ride the one-material morph so the whole
           surface dissolves to white together. */
        morphSurface(() => quietRef.current());
      }
    }, 1000);

    return () => {
      clearInterval(tick);
      evs.forEach((e) => document.removeEventListener(e, mark, opts));
    };
  }, []);

  const ariaState = !alive
    ? "Tex is no longer responding. The connection to the witness was lost."
    : ignitionReady && ignitionDoorOpen
    ? "I am Tex. Nothing happens without me. Press Begin."
    : mapping
    ? "Tex is waking the estate."
    : state === "held"
    ? "Tex is holding a decision for you."
    : state === "faltering"
    ? "Tex's integrity has failed."
    : TYPING_ENABLED
    ? /* Both ask paths are advertised to assistive tech — the typed path is the
         dead-mic / can't-speak lifeline, so a screen-reader user must learn it. */
      "Tex, watching. Hold to speak. Type to write."
    : "Tex, watching. Press and hold anywhere to speak.";

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
      onPointerCancel={cancelHold}
      onContextMenu={(e) => {
        /* No browser menu may open over a live mic; idle right-click (copy a
           hash) stays native. */
        if (holdActiveRef.current) e.preventDefault();
      }}
      onBlur={(e) => {
        /* Focus escaping the field mid-hold cancels to silence — unless it
           merely moved into a child (the held card's own acts). */
        if (
          holdActiveRef.current &&
          !(e.relatedTarget && e.currentTarget.contains(e.relatedTarget))
        ) {
          cancelHold();
        }
      }}
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

      {/* The seal — a resolved decision, shown briefly before silence. The
          verdict speaks in the INSTRUMENT register (a small tracked tag, the same
          voice the credibility tier uses), never Tex's own large voice — one word,
          "sealed", and the sealed number carries the weight, computing itself onto
          the glass. A verdict seal only reads "sealed" (and shows a number) once
          the backend's real anchor has arrived; until then it reads a calm
          "sealing" and the mapping mark computes — never a "sealed" assertion or a
          number over a seal still in flight. Keeping-holding is not a seal: it
          reads "held", quiet, no cinematic. */}
      {sealed && (
        <div
          className="tex-seal"
          role="status"
          /* The crypto scheme stays REACHABLE — carried on the seal's own
             description (hover tooltip + accessibility tree), where the proof
             detail belongs — but no longer resident chrome competing with the
             one earned moment. The hero holds only the verdict tag, the locking
             hash, and the timestamp; the hash deepening to ink IS the proof. */
          title={
            sealed.signature
              ? `${
                  sealed.signature.post_quantum
                    ? "post-quantum sealed"
                    : "sealed"
                } · ${sealed.signature.algorithm}`
              : undefined
          }
        >
          {(() => {
            const isSeal =
              sealed.verdict === "approved" || sealed.verdict === "refused";
            /* A verdict seal is only truly SEALED when the wire has handed back a
               real anchor; while pending it is still computing. */
            const anchorReady =
              isSeal &&
              !sealed.pending &&
              sealed.anchor &&
              (SEAL_ANCHOR_RE.test(sealed.anchor) ||
                SEALED_NUMBER_RE.test(sealed.anchor));
            const tag = !isSeal ? "held" : anchorReady ? "sealed" : "pending";
            return (
              <>
                <p className={`tex-seal-tag tex-seal-tag--${tag}`}>
                  <span className="tex-seal-tag-mark" aria-hidden="true" />
                  <span className="tex-seal-tag-label">
                    {tag === "pending" ? "sealing" : tag}
                  </span>
                </p>
                {isSeal && !anchorReady ? (
                  /* Computing the anchor — the honest working mark, no number. */
                  <MappingMark />
                ) : anchorReady && SEAL_ANCHOR_RE.test(sealed.anchor) ? (
                  <>
                    <SealAnchor hash={sealed.anchor} />
                    <p className="tex-seal-hash">
                      {sealed.at.toLocaleTimeString()}
                    </p>
                  </>
                ) : anchorReady ? (
                  <>
                    <ScrambleSeal
                      value={sealed.anchor}
                      className="tex-seal-anchor"
                    />
                    <p className="tex-seal-hash">
                      {sealed.at.toLocaleTimeString()}
                    </p>
                  </>
                ) : (
                  <p className="tex-seal-hash">
                    {sealed.at.toLocaleTimeString()}
                  </p>
                )}
              </>
            );
          })()}
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
              {gateOpen ? (
                /* The velvet rope — Begin was pressed; the summons waits on the
                   word. It lives in the SAME reserved slot as Begin, so the
                   manifesto above never jumps. data-act keeps the press off the
                   ask-mic; Enter (form submit) or Continue verifies, Escape backs
                   out. */
                <form className="tex-passcode" onSubmit={submitPasscode}>
                  <input
                    ref={passInputRef}
                    type="password"
                    data-act="passcode"
                    className={
                      "tex-passcode-field" + (passWrong ? " is-wrong" : "")
                    }
                    value={passInput}
                    onChange={(e) => {
                      setPassInput(e.target.value);
                      if (passWrong) setPassWrong(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") closeGate();
                    }}
                    placeholder={passWrong ? "not the word" : "passphrase"}
                    aria-label="Passphrase to begin"
                    aria-invalid={passWrong || undefined}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    type="submit"
                    data-act="passcode"
                    className="tex-act tex-act--approve"
                    disabled={ignition.igniting}
                  >
                    Continue
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  data-act="begin"
                  className="tex-act tex-act--approve"
                  disabled={!manifestoDone || ignition.igniting}
                  aria-hidden={manifestoDone ? undefined : true}
                  onClick={openGate}
                >
                  Begin
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tex is down — the backend was unreachable at load. A single quiet Inter
          line, third-person because Tex cannot speak for itself when the wire is
          gone (the same voice as the visually-hidden lost message above, not a
          confession in Tex's own register). No spinner, no red. useIgnition keeps
          re-checking underneath; the instant a status read lands this clears and
          the surface resolves properly — the live vigil, or the first-run
          ceremony. It never co-renders with the door: doorOpen requires
          ignition.ready, which is false while down. */}
      {ignition.down && (
        <div
          className="tex-door"
          role="status"
          aria-live="polite"
          aria-label="Tex is not reachable"
        >
          <p className="tex-door-sentence tex-door-down">Tex isn’t reachable.</p>
        </div>
      )}

      {/* The mapping working state. Tex is already awake, so "mapping" is it
          showing its work: the word holds in the statement register while the
          nascent anchor — the seal a breath before it exists — sweeps beneath
          it as real discovery runs, then settles into the count. */}
      {mapping && (
        <div
          className="tex-door"
          role="status"
          aria-live="polite"
          aria-label="Waking the estate"
        >
          <p className="tex-door-sentence tex-mapping">Waking</p>
          <MappingMark />
        </div>
      )}

      {/* The held decision — Tex's voice, the facts, the resolved acts. While a
          spoken answer is overlaying the glass (a reach answered while held), the
          card RECEDES so the answer reads alone, then returns when it dissolves —
          never the two sentences mushed on top of each other. It also recedes
          during the gate-verification pause, so the deliberation mark reads alone
          before the answer arrives. */}
      {/* The ignite declaration owns the glass for its beat: while the spoken
          count is up (spoken.kind === "ignite"), the held card WAITS — the same
          precedence the held VOICE already obeys (it defers announcing during
          the ignite episode and speaks the moment the line dissolves). Without
          this, a standing hold stomps the declaration the instant waking ends
          and the count is heard but never seen. */}
      {!doorOpen &&
        !mapping &&
        spoken?.kind !== "ignite" &&
        state === "held" &&
        decision &&
        heldMode !== "pending" &&
        !sealed && (
        <div
          className={`tex-held${
            answer ||
            spanAnswer ||
            verifying ||
            isTyping ||
            (dismissKey != null && heldReceded === dismissKey)
              ? " is-receded"
              : ""
          }`}
        >
          {heldMode === "queue" ? (
            /* The walk — the queue the summary counted, one decision at a
               time (HeldRowsList: the progress line, the three acts, the seal
               beat between). Hidden while an answer overlays the glass: the
               answer block renders the same list, never both at once. */
            !answer &&
            !spanAnswer && (
              <HeldRowsList rows={heldRows} onResolve={resolveHeldRow} />
            )
          ) : heldMode === "summary" ? (
            /* COUNT-FIRST — the return posture. A returning operator is told
               how many decisions wait, and one act opens the walk. The
               decisions themselves stay one press away, so the count reads
               alone — never one decision's card with the rest hiding behind
               it. */
            <>
              <p className="tex-held-sentence">{heldWaitingLine}</p>
              <div className="tex-acts">
                <button
                  type="button"
                  data-act="see"
                  className="tex-act"
                  onClick={() =>
                    morphSurface(() => setHeldRows(heldWaitingLive))
                  }
                >
                  See held decisions
                </button>
              </div>
            </>
          ) : (
            <>
          {/* WHO & WHAT — when the wire attaches the agent and its actual ask,
              the card leads with them: the agent as a chrome label, the agent's
              own ask (quoted — reported speech, never Tex's voice) in the
              headline slot, and Tex's short hand-off beneath. Neither present →
              the original presentation, byte-for-byte (the spoken heldSentence,
              then its string detail). Everything below this branch (the hold
              type/question, the certified watermark, the acts) is unchanged. */}
          {heldAgentName(decision) || heldContentExcerpt(decision) ? (
            <>
              {heldAgentName(decision) && (
                <p className="tex-held-agent">{heldAgentName(decision)}</p>
              )}
              {heldContentExcerpt(decision) ? (
                <>
                  <p className="tex-held-excerpt">
                    {`“${heldContentExcerpt(decision)}”`}
                  </p>
                  <p className="tex-held-tex-line">{heldTexLine(decision)}</p>
                </>
              ) : (
                <p className="tex-held-sentence">{heldSentence(decision)}</p>
              )}
            </>
          ) : (
            <>
              <p className="tex-held-sentence">{heldSentence(decision)}</p>
              {typeof heldDetail(decision) === "string" && heldDetail(decision) && (
                <p className="tex-held-detail">{heldDetail(decision)}</p>
              )}
            </>
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
          {/* The acts belong to a decision the seal can actually resolve — a
              stored decision id or a calibration proposal. The aggregate
              fallback ("N actions are waiting…", id: null) gets NO acts: one
              blind act over a whole queue would seal nothing and lie about
              it. */}
          {(decision?.id || isCalibration(decision)) && (
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
          )}
            </>
          )}
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
          {heldMode === "card" && heldCertifiedWatermark(heldHold(decision)) && (
            <p className="tex-held-cert" aria-hidden="true">
              {heldCertifiedWatermark(heldHold(decision))}
            </p>
          )}
          <p className="tex-held-ask" aria-hidden="true">
            press and hold anywhere to ask Tex about it
          </p>
        </div>
      )}

      {/* The conversation trail — the turns before this one, receded: smaller,
          fainter, stacked above the living answer, oldest dissolving first.
          Kept until "refresh" (spoken or typed) or Escape clears the topic.
          Display-only history: no gestures land on it, and it yields to the
          held card when the card holds the glass alone. */}
      {!doorOpen &&
        !mapping &&
        !sealed &&
        trail.length > 0 &&
        !(
          state === "held" &&
          decision &&
          !answer &&
          !spanAnswer &&
          !verifying &&
          !isTyping
        ) && (
          <div
            className={
              "tex-trail" + (answer || spanAnswer ? "" : " tex-trail--tight")
            }
            aria-hidden="true"
          >
            {trail.map((t) => (
              <div className="tex-trail-item" key={t.id}>
                {t.q && <p className="tex-trail-q">{t.q}</p>}
                <p className="tex-trail-a">{t.a}</p>
              </div>
            ))}
          </div>
        )}

      {/* The heard line — the operator's own words forming live while the mic
          is held. Faint while interim (still forming), settling to ink the
          moment the release finalizes them: proof Tex heard, shown BEFORE the
          answer round-trip even begins. It rides above the listening glow and
          the deliberation mark — the centre stays Tex's — and yields the
          instant the answer takes the glass. The words are the operator's own,
          so they are not announced back (aria-hidden). */}
      {!doorOpen && !mapping && !sealed && !answer && heard && (holding || thinking || verifying) && (
        <div
          className={`tex-heard${holding ? "" : " is-settled"}`}
          aria-hidden="true"
        >
          {heard}
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
      {/* state !== "held" keeps "Here."/falter from fighting the held card —
          but the IGNITE count renders even while held: the card is suppressed
          for exactly that beat (see the held-card gate above), so the
          declaration is seen as well as heard. */}
      {!doorOpen &&
        !mapping &&
        !answer &&
        !spanAnswer &&
        (state !== "held" || spoken?.kind === "ignite") &&
        !sealed && (
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

      {/* The FLUID-TRUTH span answer (VITE_TEX_SPANS only) — the AnswerResponse
          as an ordered stack of spans, each voiced in its own tier's prosody.
          Flag-gated and mutually exclusive with the plain answer (surfaceAnswer
          clears spanAnswer and vice versa), so with the flag off this branch is
          dead and the surface is byte-identical. */}
      {SPANS_ENABLED && !doorOpen && !mapping && !sealed && spanAnswer && (
        <div
          className={`tex-presence${
            trail.length > 0 || heldRows?.length ? " tex-presence--anchored" : ""
          }`}
          aria-live="polite"
        >
          <SpanAnswer
            answer={spanAnswer.res}
            question={spanAnswer.question}
            answerWord={answerWord}
            /* The HELD act is armed only while there is a queue to click into
               and it is not already on the glass — the moment the rows rise,
               the chip retires inside the same morph (an affordance and the
               thing it summons never stand together). When the answer carries
               the EXACT holds it spoke (list_held_waiting rows), the act walks
               THOSE — newest first — so the queue can never disagree with the
               sentence. Otherwise it is EXACTLY today's act: the phrasing-gated
               sink fetch (surfaceHeldRows). */
            onResolveHeld={
              heldRows?.length
                ? undefined
                : spanSpokenHeld.length
                ? () => surfaceSpokenHeldRows(spanSpokenHeld)
                : spanAnswerHeldness(spanAnswer.res, spanAnswer.question)
                ? surfaceHeldRows
                : undefined
            }
          />
          {/* The held rows — the SAME queue the plain answer and the held card
              render (one queue, one truth), risen beneath the span stack on
              the HELD act's press, or already mid-walk when this answer took
              the glass. */}
          <HeldRowsList rows={heldRows} onResolve={resolveHeldRow} />
        </div>
      )}

      {/* The presence answer — the one transient exception to "answers are spoken,
          never written". Tex's grounded line, lit as it is voiced, carrying the
          credibility TIER the gate sealed (a visible, honest signal), the abstain
          reason when it abstains, and any claims you can reach into for their
          evidence. It rises, holds long enough to be read and reached for, then
          dissolves — voiced-and-gone, never persisted. */}
      {!doorOpen && !mapping && !sealed && answer && (
        <div
          className={`tex-presence${
            trail.length > 0 || heldRows?.length ? " tex-presence--anchored" : ""
          }`}
          aria-live="polite"
        >
          {/* The question that produced this answer — the operator's own words,
              receded above the line: smaller, fainter, still theirs. */}
          {answer.question && (
            <p className="tex-presence-question" aria-hidden="true">
              {answer.question}
            </p>
          )}
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
              {/* The tier word is the claim; its gloss is self-narration the
                  surface can hold back — visible only on ABSTAIN, where it
                  carries the WHY. Sighted + aria read the same law as the
                  span answers. */}
              {answer.tier === TIER.ABSTAIN && (
                <span className="tex-tier-gloss">
                  {answer.tierReason || TIER_GLOSS[answer.tier]}
                </span>
              )}
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

          {/* The held rows — the queue the sentence counted, each resolvable in
              place (see HeldRowsList; the aggregate held card renders the same
              list, so the two surfaces can never drift apart). */}
          <HeldRowsList rows={heldRows} onResolve={resolveHeldRow} />

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

      {/* TYPE TO WRITE — the transient typed line, now its own memoized leaf so a
          keystroke re-renders one element, not this whole surface. The question
          forms in the SAME voice register Tex answers in, centered; a real <input>
          (native caret, selection, IME, mobile predictive text), latent-mounted at
          rest on both touch and desktop so the first keystroke — or the touch
          glyph's tap — focuses it synchronously. Voiced-and-gone. Vigil hands down
          the two surface acts (onBegin clears the glass, onSubmit runs the grounded
          round-trip) and learns back only the EDGE via onTypingChange. */}
      {TYPING_ENABLED &&
        !doorOpen &&
        !mapping &&
        (isTyping || isCoarsePointer || canType) && (
          <TypedLine
            canType={canType}
            isCoarsePointer={isCoarsePointer}
            holding={holding}
            watchTenant={watchTenant}
            onBegin={onTypingBegin}
            onSubmit={onTypingSubmit}
            onTypingChange={onTypingChange}
          />
        )}

      {/* The object — the one thing the screen is ever allowed to hold: a
          handle you grab and walk away with. It rises alone, monospace,
          centered, only because you reached for it, and dissolves the moment
          it has been taken. When an answer is on the glass the handle rises
          inside that presence block instead (above), so it never double-renders. */}
      {!doorOpen && !mapping && state !== "held" && !answer && !spanAnswer && !sealed && surfaced && (
        <div className="tex-object" role="status" aria-live="polite">
          <span className="tex-object-value" key={surfaced.value}>
            {surfaced.value}
          </span>
        </div>
      )}

      {/* The at-rest whisper — the one resident tell that the silent glass can be
          reached, revealed only after REST_HINT_MS of true stillness and dissolved
          a rung faster on any activity (mount is gated to the silent surface, so a
          decision / answer / seal removes it at once; `is-shown` drives the fade).
          aria-hidden: the section's own aria-label already names both gestures, so
          this must not double-announce to assistive tech. On touch the write glyph
          already teaches "write", so the copy keeps only the hidden speak gesture. */}
      {!doorOpen &&
        !mapping &&
        state === "silent" &&
        !sealed &&
        !answer &&
        !spanAnswer &&
        !surfaced &&
        !spoken &&
        !isTyping &&
        alive && (
          <p
            className={`tex-rest-hint${restHint ? " is-shown" : ""}${
              isCoarsePointer ? " tex-rest-hint--touch" : ""
            }`}
            aria-hidden="true"
          >
            {TYPING_ENABLED && !isCoarsePointer
              ? "hold anywhere to speak · type to write"
              : "hold anywhere to speak"}
          </p>
        )}
    </section>
  );
}
