/**
 * texApi.js
 *
 * The frontend's only door into Tex.
 *
 * Three calls. Every one of them maps to an endpoint that actually exists
 * in github.com/MattNardizzi/tex. No aspirational endpoints, no chat
 * inputs, no acknowledge actions. Tex talks; the operator listens. The
 * API exists to fetch the truth Tex is speaking, nothing more.
 *
 *   getSystemState()         → GET /v1/system/state
 *   getDecisionReplay(id)    → GET /decisions/{id}/replay
 *   getEvidenceBundle(id)    → GET /decisions/{id}/evidence-bundle
 *
 * The base URL comes from VITE_TEX_API_BASE so Vercel preview deploys
 * and local dev can point at different backends. The default is the
 * live Render deployment, so the production build of the frontend
 * always speaks to a real Tex even if the env var is missing.
 */

const FALLBACK_BASE = "https://tex-uh4j.onrender.com";
const BASE = (import.meta.env.VITE_TEX_API_BASE || FALLBACK_BASE).replace(
  /\/$/,
  ""
);

/* The fetch wrapper is intentionally small. No retries, no exponential
   backoff, no custom error envelopes. If the call fails, the hook above
   surfaces null and the vigil keeps speaking the last known truth.
   Silence is Tex's failure mode — not a toast notification. */
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
 * The aggregate read. One round trip returns:
 *   - governance totals (total_agents, governed_pct, coverage_root_sha256)
 *   - last_scan summary (candidates_seen, registered_count, ledger range)
 *   - connector_health per platform
 *   - scheduler state (presence_tracker_enabled, interval_seconds)
 *   - latest_drift events
 *   - chain (discovery_ledger_length, chain integrity, durable_persistence)
 *
 * This is what the six vigil sentences speak from. Five of the six
 * derive purely from this response. The sixth (learning) needs the
 * /v1/learning/proposals endpoint, which we add when the backend has
 * proposals to surface.
 */
export const getSystemState = () => request("/v1/system/state");

/**
 * Fetch the full Decision record for a prior evaluation. Used by the
 * proof layer when the operator clicks the execution-governance sentence
 * — Tex finishes the story by quoting from the actual decision the
 * hash signs.
 */
export const getDecisionReplay = (decisionId) =>
  request(`/decisions/${encodeURIComponent(decisionId)}/replay`);

/**
 * Fetch the hash-chained evidence bundle for one decision. The bundle
 * carries the record_hash that becomes the monospace watermark revealed
 * on hover of the proof layer's anchor line.
 */
export const getEvidenceBundle = (decisionId) =>
  request(`/decisions/${encodeURIComponent(decisionId)}/evidence-bundle`);

/* Exported so the hook can label which backend it's speaking to in dev. */
export const TEX_API_BASE = BASE;
