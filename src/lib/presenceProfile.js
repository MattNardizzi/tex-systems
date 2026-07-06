/**
 * presenceProfile.js — the two-way confirm/correct loop (Presence L2).
 *
 * The operator hears Tex speak a claim and can CONFIRM it ("that's right") or
 * CORRECT it ("that's wrong / you were too confident"). A correction is a sealed,
 * citable, REVOCABLE label that TIGHTENS the next answer for that subject — it can
 * only move Tex toward caution, never make it more confident. This is the
 * "becomes more yours the more you use it" layer.
 *
 * Same wire as the rest of the surface: every call rides the same-origin
 * `/api/tex/*` proxy (the proxy holds the API key + the key carries the tenant, so
 * the tenant is resolved server-side from the principal — the browser never names
 * a tenant). The frontend computes nothing about what Tex remembers; it posts the
 * operator's deliberate human act and renders the sealed receipt.
 *
 * Backend (owned by L2, see ../../../tex/src/tex/api/presence_profile_routes.py):
 *   POST   /v1/presence/profile/correct   → seal a tightening correction
 *   POST   /v1/presence/profile/confirm   → seal a positive (non-inflating) receipt
 *   GET    /v1/presence/profile           → recall this tenant's active facts
 *   DELETE /v1/presence/profile/{id}      → revoke (forget) a fact
 */

const BASE = "/api/tex";

/* Intentionally tiny — no retries, no backoff (the texApi.js doctrine). A failed
   write surfaces an honest error; it never silently "succeeds". */
async function request(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tex API ${res.status} on ${path}: ${body || res.statusText}`);
  }
  return res.json();
}

const tenantQS = (tenantId) =>
  tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";

/**
 * POST /v1/presence/profile/correct — "that's wrong / too confident".
 *
 * ``correctedTier`` is the ceiling to impose: "abstain" (don't speak this as fact)
 * or "derived" (don't speak it as SEALED). It can NEVER be "sealed" — the backend
 * refuses an upward correction (asserting confidence Tex cannot prove). Returns the
 * sealed receipt:
 *   { record_id, anchor_sha256, store, kind, subject_key, corrected_tier,
 *     operator, created_at, signature: {...|null}, calibration_fed, tenant }
 */
export const correctClaim = (
  { claimId, correctedTier = "abstain", originalTier, operator = "operator", statement, decisionId },
  tenantId
) =>
  request(`/v1/presence/profile/correct${tenantQS(tenantId)}`, {
    method: "POST",
    body: JSON.stringify({
      claim_id: claimId,
      corrected_tier: correctedTier,
      original_tier: originalTier ?? null,
      operator,
      statement: statement ?? "",
      decision_id: decisionId ?? null,
    }),
  });

/**
 * POST /v1/presence/profile/confirm — "that's right".
 *
 * A positive, NON-inflating receipt (it can never raise a future tier — to loosen
 * a prior correction you revoke it). ``tier`` is the tier Tex spoke that you are
 * affirming. Returns the same receipt shape with ``kind: "confirmation"`` and
 * ``calibration_fed: false`` (a confirm is honest about not tightening anything).
 */
export const confirmClaim = (
  { claimId, tier, operator = "operator", statement, decisionId },
  tenantId
) =>
  request(`/v1/presence/profile/confirm${tenantQS(tenantId)}`, {
    method: "POST",
    body: JSON.stringify({
      claim_id: claimId,
      tier,
      operator,
      statement: statement ?? "",
      decision_id: decisionId ?? null,
    }),
  });

/** GET /v1/presence/profile — this tenant's active (non-revoked) facts, citable. */
export const recallProfile = (tenantId, query) => {
  const params = new URLSearchParams();
  if (tenantId) params.set("tenant_id", tenantId);
  if (query) params.set("query", query);
  const qs = params.toString();
  return request(`/v1/presence/profile${qs ? `?${qs}` : ""}`);
};

/**
 * DELETE /v1/presence/profile/{record_id} — revoke (forget) a fact. Returns
 * { tenant, record_id, revoked, calibration_forgotten }. ``revoked: true`` means
 * the fact is gone from the store and stops influencing future answers.
 */
export const revokeProfileFact = (recordId, tenantId) =>
  request(
    `/v1/presence/profile/${encodeURIComponent(recordId)}${tenantQS(tenantId)}`,
    { method: "DELETE" }
  );
