/* HabitHypothesis — the "I've noticed…" offer (Presence L3).
 *
 * Tex surfaces a pattern it noticed in THIS tenant's own sealed history and offers to
 * make it a standing rule. The card shows three things and nothing more:
 *   1. the offer, in Tex's words ("I've noticed … 6 of 6 … want me to defer to you?");
 *   2. the RECEIPTS — the exact count of sealed records behind it, hold-to-see, so the
 *      operator can see this is a count over real evidence, not a guess;
 *   3. an honest confidence label (a heuristic screen, never a guarantee).
 *
 * Two affordances: Confirm (→ seals ONE tightening L2 correction; Tex will defer to
 * you on this subject) or Not now (→ writes nothing; the offer just dissolves). It
 * computes nothing about the pattern — the pattern is mined server-side; this posts the
 * operator's deliberate act, keyed by the content-addressed hypothesis_id, and renders
 * the sealed receipt, then dissolves (the same "surface, then dissolve" idiom as the
 * rest of the glass).
 *
 * Self-contained (own state + styles). Mount it where Tex surfaces habits — e.g. a
 * panel after a session, or beside the Vigil. It never edits Dashboard/SpokenLine.
 */
import { useState } from "react";
import { confirmHabit, declineHabit } from "../../lib/presenceHabits";
import "./HabitHypothesis.css";

const short = (h) => (h ? `${h.slice(0, 10)}…` : "");
const pct = (r) => `${Math.round((Number(r) || 0) * 100)}%`;

export default function HabitHypothesis({ hypothesis, tenantId, decisionId, onResolved }) {
  const [state, setState] = useState("idle"); // idle | busy | confirmed | declined | error
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);

  if (!hypothesis?.hypothesis_id) return null;
  const { hypothesis_id, phrasing, confidence, supporting = [], subject_key, proposed_tier } =
    hypothesis;
  const n = confidence?.n ?? supporting.length;
  const k = confidence?.k ?? supporting.length;

  async function confirm() {
    setState("busy");
    setError(null);
    try {
      const res = await confirmHabit({ hypothesisId: hypothesis_id, decisionId }, tenantId);
      setReceipt(res);
      setState("confirmed");
      onResolved?.("confirmed", res);
    } catch (e) {
      setError(String(e?.message || e));
      setState("error");
    }
  }

  async function decline() {
    setState("busy");
    try {
      await declineHabit({ hypothesisId: hypothesis_id }, tenantId).catch(() => {});
      setState("declined");
      onResolved?.("declined", null);
    } catch {
      setState("declined"); // declining writes nothing; never block on its failure
    }
  }

  if (state === "confirmed") {
    return (
      <div className="tex-habit tex-habit-done is-confirm" role="status">
        <span className="tex-habit-msg">
          Done — Tex will defer to you on <em>{subject_key}</em> from now on.
        </span>
        {receipt?.anchor_sha256 && (
          <span className="tex-habit-anchor" title={receipt.anchor_sha256}>
            sealed {short(receipt.anchor_sha256)}
          </span>
        )}
      </div>
    );
  }

  if (state === "declined") {
    return (
      <div className="tex-habit tex-habit-done is-decline" role="status">
        <span className="tex-habit-msg">Okay — nothing changed.</span>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="tex-habit tex-habit-error" role="alert">
        <span className="tex-habit-msg" title={error || ""}>couldn’t seal that</span>
        <button type="button" className="tex-habit-btn" onClick={() => setState("idle")}>
          retry
        </button>
      </div>
    );
  }

  const busy = state === "busy";
  return (
    <div className="tex-habit" aria-busy={busy}>
      <p className="tex-habit-offer">{phrasing}</p>
      <div className="tex-habit-meta">
        <span
          className="tex-habit-receipts"
          title={supporting.map((r) => `${r.store}:${r.record_id}`).join("\n")}
        >
          {k} of {n} sealed records
        </span>
        {confidence?.label && (
          <span className="tex-habit-floor" title={confidence.label}>
            consistency ≥ {Number(confidence.wilson_lower ?? 0).toFixed(2)}
          </span>
        )}
        {proposed_tier && <span className="tex-habit-tier">→ {String(proposed_tier).toLowerCase()}</span>}
      </div>
      <div className="tex-habit-actions">
        <button
          type="button"
          className="tex-habit-btn tex-habit-yes"
          disabled={busy}
          onClick={confirm}
          title="Make this a standing rule — Tex will defer to you on this subject"
        >
          Make it a rule
        </button>
        <button
          type="button"
          className="tex-habit-btn tex-habit-no"
          disabled={busy}
          onClick={decline}
          title="Dismiss — nothing changes"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
