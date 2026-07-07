/**
 * answers.js — the typed-ask door into the FLUID-TRUTH ANSWER PIPELINE.
 *
 * POST /v1/answer is "Claude under oath": the backend answers a typed question
 * as an ordered list of SPANS, each a template whose number-slots are filled by
 * deterministic exhibits (tool-computed values, never model-authored digits).
 * The surface renders the spans and speaks them; it computes nothing about what
 * they say.
 *
 * This mirrors texApi.js exactly — same-origin proxy, keyed-vs-DEV tenant
 * posture — but does NOT import that module's private helpers (BASE / request /
 * scopedTenant are module-local there). The proxy contract is a stable boundary,
 * so re-declaring the same idiom here keeps this workstream on its own file
 * without reaching across the seam. If texApi.js ever exports these, collapse to
 * the shared version.
 */

/* Same-origin proxy prefix. The proxy holds TEX_API_BASE / TEX_API_KEY. Kept
   identical to texApi.js — the browser never speaks to Render directly and never
   holds the key. */
const BASE = "/api/tex";

/* Resolve the tenant for a scoped call, mirroring texApi.js precisely. PRODUCTION
   IS ALWAYS KEYED: the proxy injects TEX_API_KEY and the backend resolves the
   tenant from the principal, so sending a tenant_id in prod COLLIDES with the
   key's tenant and 403s the read. So we OMIT the id in the keyed (prod) posture
   and let the key speak; only DEV (local, keyless backend) scopes by the id. */
const scopedTenant = (tenantId) =>
  import.meta.env.DEV ? tenantId || undefined : undefined;

/**
 * POST /api/tex/v1/answer — ask a typed question and get back an AnswerResponse:
 *
 *   {
 *     tenant_id, question,
 *     spans: [ { template, text, slots, verdict, anchor_sha256, prosody } ],
 *     exhibits: [ { handle, kind, value, spoken, unit, query, anchor_sha256,
 *                   computed_at } ],
 *     spoken_text,                        // concatenation of surviving span texts
 *     overall_tier: "SEALED" | "DERIVED" | "ABSTAIN",
 *     abstain_reason: str | null          // e.g. "unsupported_intent" | "no_scoped_tool"
 *   }
 *
 * Every value a span speaks is deterministic code over real rows — the model
 * writes the music, never the digits. A zero count is a SEALED truth, not an
 * abstain; ABSTAIN is the calm, first-class "I don't have a sealed way to answer
 * that yet."
 *
 * This throws an Error whose message begins "Tex answer <status>" on any non-2xx
 * so the caller can distinguish a route that isn't mounted yet (404/501 → fall
 * back to the existing askTex path) from a real failure. The keyed/dev tenant
 * posture matches texApi.js: the key carries the tenant in prod; only DEV scopes.
 */
export async function askAnswer(question, tenantId) {
  const res = await fetch(`${BASE}/v1/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: question ?? "",
      tenant_id: scopedTenant(tenantId) ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `Tex answer ${res.status} on /v1/answer: ${body || res.statusText}`
    );
    /* The status rides on the error so the caller can branch on "not mounted
       yet" (404/501) without re-parsing the message string. */
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * isRouteAbsent(err) — true when a thrown askAnswer error means the route is not
 * mounted yet (404) or not implemented (501), the two "fall back to askTex
 * silently" cases. Any other failure is a real error the caller should surface
 * as an honest abstain-tier line, never a silent swallow.
 */
export const isRouteAbsent = (err) =>
  err && (err.status === 404 || err.status === 501);
