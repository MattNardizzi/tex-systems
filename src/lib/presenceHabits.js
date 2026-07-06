/**
 * presenceHabits.js — the "I've noticed…" habit-hypothesis surface (Presence L3).
 *
 * Tex notices recurring patterns in THIS tenant's own sealed history (e.g. "of the
 * 6 decisions about offshore wires on record, all 6 were forbidden") and OFFERS them
 * as hypotheses. A hypothesis is never an assertion: it carries the exact sealed
 * records that support it and a COMPUTED confidence, and it changes nothing until the
 * operator confirms it. Confirming writes ONE sealed, revocable L2 correction that can
 * only ever move Tex toward caution (defer/abstain) on that subject — never make it
 * more confident.
 *
 * The frontend computes NOTHING about the pattern. The pattern is mined server-side by
 * a deterministic miner over sealed records; this client only fetches the offered
 * hypotheses and posts the operator's deliberate confirm/decline. A hypothesis is
 * identified by its content-addressed `hypothesis_id` ("hh-<sha256>"), so confirming
 * can only act on a hypothesis the server itself currently surfaces — a stale or forged
 * id simply will not match and the backend refuses it.
 *
 * Same wire as the rest of the surface: every call rides the same-origin `/api/tex/*`
 * proxy (the proxy holds the key + the key carries the tenant, resolved server-side —
 * the browser never names a tenant or an operator).
 *
 * Backend (orchestrator-provided; see ../../../tex/src/tex/presence/habits/HABITS_INTERFACE.md):
 *   GET    /v1/presence/habits              → the tenant's offered hypotheses
 *   POST   /v1/presence/habits/confirm      → confirm one (by hypothesis_id) → L2 correction
 *   POST   /v1/presence/habits/decline      → record a "no" (writes nothing)
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
 * GET /v1/presence/habits — the hypotheses Tex is offering this tenant.
 *
 * Returns { tenant, count, hypotheses: [ {
 *   hypothesis_id, subject_key, dimension, dominant_outcome, proposed_tier,
 *   phrasing, confidence: { n, k, point_rate, wilson_lower, family_size, label },
 *   supporting: [ { record_id, record_hash, store } ]
 * } ] }. Read-only and inert — fetching offers nothing and changes nothing.
 */
export const recallHabits = (tenantId) =>
  request(`/v1/presence/habits${tenantQS(tenantId)}`);

/**
 * POST /v1/presence/habits/confirm — "yes, make that a rule".
 *
 * Confirms the hypothesis identified by `hypothesisId`. The server re-mines, matches
 * the content-addressed id, and (if it still holds) writes ONE L2 correction capping
 * the subject's tier at the proposed ceiling. `decisionId`, when the hypothesis is
 * about a governance decision, lets the backend feed L1 calibration server-side.
 * Returns the L2 correction receipt:
 *   { record_id, anchor_sha256, store: "presence_profile", subject_key,
 *     corrected_tier, operator, created_at, signature: {...|null}, tenant }
 */
export const confirmHabit = ({ hypothesisId, decisionId }, tenantId) =>
  request(`/v1/presence/habits/confirm${tenantQS(tenantId)}`, {
    method: "POST",
    body: JSON.stringify({
      hypothesis_id: hypothesisId,
      decision_id: decisionId ?? null,
    }),
  });

/**
 * POST /v1/presence/habits/decline — "not now".
 *
 * Records (for the audit log) that the operator looked and said no. Writes nothing to
 * any store — declining is the default, this just makes it auditable. Returns
 * { tenant, hypothesis_id, declined: true }.
 */
export const declineHabit = ({ hypothesisId }, tenantId) =>
  request(`/v1/presence/habits/decline${tenantQS(tenantId)}`, {
    method: "POST",
    body: JSON.stringify({ hypothesis_id: hypothesisId }),
  });
