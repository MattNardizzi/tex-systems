/**
 * texApi.js
 *
 * The frontend's only door into Tex — and that door is same-origin.
 *
 * Every call goes to `/api/tex/*`, the Vercel serverless proxy, which
 * forwards to the real backend on Render and attaches the API key
 * server-side. The browser never holds the key and never speaks to
 * Render directly. No CORS, no secret in the bundle.
 *
 *   getVigil(tenantId?)            → GET  /v1/vigil
 *   explainLine(dimension, ...)    → POST /v1/vigil/explain
 *   getSystemState()               → GET  /v1/system/state   (threshold door)
 *   getDecisionReplay(id)          → GET  /decisions/{id}/replay
 *   getEvidenceBundle(id)          → GET  /decisions/{id}/evidence-bundle
 *
 * The vigil is the live voice: Tex chooses what to say on the backend
 * (Bayesian surprise across the six dimensions, sealed-filled sentences),
 * and the frontend renders the choice. The frontend computes nothing
 * about what Tex says.
 */

/* Same-origin proxy prefix. The proxy holds TEX_API_BASE / TEX_API_KEY. */
const BASE = "/api/tex";

/* The fetch wrapper is intentionally small. No retries, no backoff, no
   error envelopes. If a call fails, the hook surfaces null and the vigil
   keeps speaking the last known truth. Silence is Tex's failure mode —
   not a toast notification. */
async function request(path, init = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tex API ${res.status} on ${path}: ${body || res.statusText}`);
  }
  return res.json();
}

/**
 * GET /v1/vigil — what Tex chose to say this cycle.
 *
 * Returns the contract the interface renders:
 *   {
 *     tenant_id, generated_at,
 *     standing: "Absolute" | "Open",
 *     utterances: [{ text, dimension, surprise, proof_ref?, requires_human }],
 *     human_decision: { ... } | null,
 *     meta: { warm, observed_dimensions, spoken, suppressed, selector_version }
 *   }
 *
 * The key carries the tenant in keyed posture, so tenant_id is usually
 * left unset; pass it only when a privileged key needs to scope a read.
 */
export const getVigil = (tenantId) =>
  request(
    `/v1/vigil${tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ""}`
  );

/**
 * POST /v1/vigil/explain — finish the story behind one spoken line,
 * grounded in sealed facts.
 *
 * Returns { dimension, claim_text, explanation, facts: { headline,
 * details, anchors: [{ kind, id, sha256, seq }] }, mode, generator,
 * grounded }. The explanation prose rests on the sealed facts that
 * travel with it; the anchor sha256 is the monospace watermark the
 * proof layer reveals on hover.
 */
export const explainLine = (dimension, claimText, tenantId) =>
  request("/v1/vigil/explain", {
    method: "POST",
    body: JSON.stringify({
      dimension,
      claim_text: claimText ?? null,
      tenant_id: tenantId ?? null,
    }),
  });

/**
 * GET /v1/system/state — the aggregate read. Still used by the day-two
 * threshold door (the overnight catch-up), which has no dedicated
 * backend endpoint yet. The live vigil no longer derives from this.
 */
export const getSystemState = () => request("/v1/system/state");

/** GET /decisions/{id}/replay — full Decision record for a prior eval. */
export const getDecisionReplay = (decisionId) =>
  request(`/decisions/${encodeURIComponent(decisionId)}/replay`);

/** GET /decisions/{id}/evidence-bundle — hash-chained evidence bundle. */
export const getEvidenceBundle = (decisionId) =>
  request(`/decisions/${encodeURIComponent(decisionId)}/evidence-bundle`);

export const TEX_API_BASE = BASE;
