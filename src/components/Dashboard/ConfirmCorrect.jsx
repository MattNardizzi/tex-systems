/* ConfirmCorrect — the two-way loop on a spoken claim (Presence L2).
 *
 * Two affordances, nothing more: tell Tex it was right, or tell it it was wrong.
 *
 *   ✓ Right      → seals a positive receipt (non-inflating — it can never make Tex
 *                  more confident; to loosen later, you revoke).
 *   ✗ That's wrong → seals a TIGHTENING correction: Tex will stop speaking this as
 *                  a sealed fact for you, and hold it instead. The correction is a
 *                  sealed, citable, REVOCABLE label — never a retrain.
 *
 * The control renders the sealed receipt the operator walks away with (the content
 * anchor, hold-to-see), then dissolves back. It computes nothing about credibility
 * — it posts the operator's deliberate act and shows what the backend sealed.
 *
 * S6 owns the surface: mount this beside a SpokenLine for the claim it covers, e.g.
 *   <ConfirmCorrect claimId={claim.claim_id} tier={verdict.tier}
 *                   decisionId={attestation?.decision_id} operator={operatorId} />
 * It is self-contained (its own state + styles); it never edits SpokenLine.
 */
import { useState } from "react";
import { confirmClaim, correctClaim } from "../../lib/presenceProfile";
import "./ConfirmCorrect.css";

const short = (h) => (h ? `${h.slice(0, 10)}…` : "");

export default function ConfirmCorrect({
  claimId,
  tier,
  decisionId,
  operator = "operator",
  tenantId,
  onSealed,
}) {
  const [state, setState] = useState("idle"); // idle | busy | done | error
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);

  if (!claimId) return null;

  const spokenTier = tier ? String(tier).toLowerCase() : undefined;

  async function act(kind) {
    setState("busy");
    setError(null);
    try {
      const res =
        kind === "confirm"
          ? await confirmClaim({ claimId, tier: spokenTier, operator, decisionId }, tenantId)
          : await correctClaim(
              { claimId, correctedTier: "abstain", originalTier: spokenTier, operator, decisionId },
              tenantId
            );
      setReceipt({ kind, ...res });
      setState("done");
      onSealed?.(kind, res);
    } catch (e) {
      setError(String(e?.message || e));
      setState("error");
    }
  }

  if (state === "done" && receipt) {
    const corrected = receipt.kind === "correct";
    return (
      <span className={`tex-cc tex-cc-done ${corrected ? "is-correct" : "is-confirm"}`}>
        <span className="tex-cc-msg">
          {corrected ? "Noted — Tex will hold this for you." : "Confirmed."}
        </span>
        {receipt.anchor_sha256 && (
          <span className="tex-cc-anchor" title={receipt.anchor_sha256}>
            sealed {short(receipt.anchor_sha256)}
          </span>
        )}
      </span>
    );
  }

  if (state === "error") {
    return (
      <span className="tex-cc tex-cc-error">
        <span className="tex-cc-msg" title={error || ""}>
          couldn’t seal that
        </span>
        <button type="button" className="tex-cc-btn" onClick={() => setState("idle")}>
          retry
        </button>
      </span>
    );
  }

  const busy = state === "busy";
  return (
    <span className="tex-cc" aria-busy={busy}>
      <button
        type="button"
        className="tex-cc-btn tex-cc-yes"
        disabled={busy}
        onClick={() => act("confirm")}
        title="Confirm Tex got this right"
      >
        ✓ Right
      </button>
      <button
        type="button"
        className="tex-cc-btn tex-cc-no"
        disabled={busy}
        onClick={() => act("correct")}
        title="Tell Tex it was wrong — it will stop speaking this as a sealed fact for you"
      >
        ✗ That’s wrong
      </button>
    </span>
  );
}
