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

/* ------------------------------------------------------------------ */
/* Voice — the push-to-talk loop.                                      */
/*                                                                     */
/* The recognizer stream is a direct browser→gateway WebSocket (a      */
/* serverless proxy cannot hold a streaming socket), so the listen     */
/* path needs a short-lived token + the gateway URL, both minted       */
/* server-side. The answer and synthesis paths ride the same-origin    */
/* proxy. Audio never touches a third party: the gateway is Tex's own  */
/* self-hosted infrastructure.                                         */
/* ------------------------------------------------------------------ */

/**
 * GET /v1/voice/token — mint a short-lived grant for the recognizer
 * socket. Returns { ws_url, token, expires_at }. The browser opens a
 * WebSocket to ws_url and streams 16 kHz PCM while the T is held.
 */
export const mintVoiceToken = () => request("/v1/voice/token");

/**
 * POST /v1/ask — answer a spoken question, grounded ONLY in sealed
 * facts. The transcript is what the recognizer returned on release.
 * Returns { answer, object?, proof_ref? } where:
 *   - answer:  the sentence Tex speaks (TTS). Meaning is spoken, never
 *              written to the glass.
 *   - object:  { value, kind: "hash"|"name" } | absent. The one thing
 *              the surface is allowed to hold — a handle the operator
 *              grabs and walks away with. Surfaced, then dissolved.
 *
 * This is the integrity boundary: the backend answers from the ledger
 * and the six layers, never a free-running model.
 *
 * ARCHITECTURE — do not "upgrade" this to a native speech-to-speech
 * model. As of 2026 the lowest-latency, trendiest path is an end-to-end
 * S2S model (OpenAI Realtime, Gemini Live, Grok Voice). Those models
 * GENERATE their own answers — a free-running model in the speaking
 * seat — which directly breaks the line above and the entire premise of
 * a witness that can only say what it can prove. Tex is a deliberate
 * grounded cascade: streaming STT to hear, THIS endpoint to answer from
 * sealed facts, streaming TTS (/v1/speak) to voice it. The components in
 * those three slots may be swapped for the best available (e.g. Deepgram
 * Flux / ElevenLabs Scribe for STT, ElevenLabs / Cartesia for TTS); the
 * cascade shape and the grounding boundary must not be.
 */
export const askTex = (transcript, tenantId) =>
  request("/v1/ask", {
    method: "POST",
    body: JSON.stringify({
      transcript: transcript ?? "",
      tenant_id: tenantId ?? null,
    }),
  });

/**
 * GET /v1/speak?text=... — synthesize a grounded line in Tex's ONE
 * voice and stream the audio body back through the proxy. Returned as a
 * URL so an <audio> element can stream it directly. Same voice whether
 * Tex is answering you or telling you it broke.
 */
export const speakStreamUrl = (text) =>
  `${BASE}/v1/speak?text=${encodeURIComponent(text || "")}`;

export const TEX_API_BASE = BASE;
