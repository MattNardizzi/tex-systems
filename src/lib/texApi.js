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

/* Resolve the tenant for a scoped call. The surface passes the directory the
   operator CONNECTED; nothing here implies a default estate. When no tenant is
   given the id is omitted, which is the keyed posture — the API key carries the
   tenant and the backend resolves it from the principal. */
const scopedTenant = (tenantId) => tenantId || undefined;

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
 *     human_decision: {
 *       id, sentence, detail, dimension, surprise, agent, proof_ref,
 *       requires_human, anchor_sha256,
 *       hold: {                       // the first-class abstention (Layer 4)
 *         hold_type: "EPISTEMIC" | "ALEATORIC" | "MIXED",
 *         resolution_mode: "SELF_HEAL" | "HUMAN_FACT" | "HUMAN_JUDGMENT",
 *         resolving_question,         // the one fact that would resolve it
 *         epistemic_score, aleatoric_score,
 *         band_certified,             // two-sided CRC band carries a guarantee
 *         band_lower, band_upper, final_score
 *       } | null
 *     } | null,
 *     meta: { warm, observed_dimensions, spoken, suppressed, selector_version }
 *   }
 *
 * The hold is why ABSTAIN — the only verdict the operator sees — now stands on
 * the same caliber of object as a PERMIT certificate or a FORBID proof: it
 * knows whether more information could resolve it (epistemic vs aleatoric) and
 * names the single pivotal fact. The voice speaks the meaning; the held card
 * renders the type and the question, never the case file.
 *
 * The key carries the tenant in keyed posture, so tenant_id is usually
 * left unset; pass it only when a privileged key needs to scope a read.
 */
export const getVigil = (tenantId) => {
  const t = scopedTenant(tenantId);
  return request(`/v1/vigil${t ? `?tenant_id=${encodeURIComponent(t)}` : ""}`);
};

/**
 * /v1/vigil/stream — the live voice as a Server-Sent Events stream.
 *
 * This is the 2026 SOTA for one-way server→client push: native EventSource
 * auto-reconnect + Last-Event-ID resume, riding this same same-origin proxy
 * untouched (the proxy pipes text/event-stream through with no change). The
 * WebSocket stays only where it is genuinely bidirectional — the recognizer
 * socket in texVoiceClient. The stream emits `event: vigil` frames whose data
 * is the identical VigilResponse the poll returns; useVigil subscribes here
 * and falls back to polling getVigil when EventSource is unavailable.
 *
 * Returned as a URL (EventSource takes a URL, not a fetch init). Same-origin,
 * so the proxy attaches the key server-side exactly as it does for the poll.
 */
export const vigilStreamUrl = (tenantId) => {
  const t = scopedTenant(tenantId);
  return `${BASE}/v1/vigil/stream${
    t ? `?tenant_id=${encodeURIComponent(t)}` : ""
  }`;
};

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
      tenant_id: scopedTenant(tenantId) ?? null,
    }),
  });

/**
 * GET /v1/system/state — the aggregate read. Still used by the day-two
 * threshold door (the overnight catch-up), which has no dedicated
 * backend endpoint yet. The live vigil no longer derives from this.
 */
export const getSystemState = () => request("/v1/system/state");

/* ------------------------------------------------------------------ */
/* Discovery surface — the day-one threshold (ignition) + pull-only.   */
/*                                                                     */
/* "Run discovery" is ignition, said once. The status read carries no  */
/* side effect, so the surface can decide whether to show the day-one  */
/* door WITHOUT firing it; firing is the operator's deliberate act on   */
/* ignite, which returns the single spoken line (the count, and that    */
/* Tex is beginning) and never speaks again. Both are server-           */
/* authoritative: the "fired once" truth lives in the backend's         */
/* IgnitionRegistry, not in a forgeable localStorage flag.              */
/* ------------------------------------------------------------------ */

/**
 * GET /v1/surface/discovery/status — has ignition fired for this tenant?
 * Pure read, no side effect. Returns { ignited, ignited_at }.
 */
export const getDiscoveryStatus = (tenantId) => {
  const t = scopedTenant(tenantId);
  return request(
    `/v1/surface/discovery/status${
      t ? `?tenant_id=${encodeURIComponent(t)}` : ""
    }`
  );
};

/**
 * POST /v1/surface/discovery/ignite — begin watching the estate.
 * Returns { spoken, object, already_ignited, count }. ``spoken`` is the
 * one line Tex says on ignition (e.g. "You have twenty-three agents
 * running. I'll begin."), and it is now the count of what the ignition
 * scan actually discovered — the backend runs the full multi-plane
 * discovery, seals a behavioural birth for each agent found, then speaks
 * the count. ``already_ignited`` is true if the door had already opened, in
 * which case ``spoken`` is null and the surface goes straight to silence.
 *
 * ``tenantId`` is the directory the operator connected; ignition fires once
 * for it (server-authoritative). A keyed console may omit it (the key carries
 * the tenant).
 */
export const igniteDiscovery = (tenantId) => {
  const t = scopedTenant(tenantId);
  return request(
    `/v1/surface/discovery/ignite${
      t ? `?tenant_id=${encodeURIComponent(t)}` : ""
    }`,
    { method: "POST" }
  );
};

/**
 * GET /v1/surface/discovery/count — how many agents now (pull-only, no side
 * effect). Returns { spoken, object, count }. The genuine current count for an
 * already-ignited tenant, when ignition returns already_ignited (spoken null).
 */
export const getDiscoveryCount = (tenantId) => {
  const t = scopedTenant(tenantId);
  return request(
    `/v1/surface/discovery/count${
      t ? `?tenant_id=${encodeURIComponent(t)}` : ""
    }`
  );
};

/**
 * Best-effort wake. A sleeping backend (Render free tier) needs a moment to
 * boot; GET /health spins it up before a heavy call so the real request lands
 * on a warm server. Never throws — the caller ignores the result.
 */
export const wakeBackend = async () => {
  try {
    await fetch(`${BASE}/health`, { method: "GET", cache: "no-store" });
  } catch (_e) {
    /* ignore — this is only a warm-up */
  }
};

/**
 * GET /health — a tenant-agnostic liveness ping. Resolves on a reachable
 * backend (2xx) and throws otherwise. Unlike the vigil, it reads NO estate:
 * the heartbeat must prove the wire is alive without pulling any tenant's
 * data, so a surface watching nothing (no directory connected yet) still
 * never touches a default/simulated estate.
 */
export const pingBackend = async () => {
  const res = await fetch(`${BASE}/health`, { method: "GET", cache: "no-store" });
  if (!res.ok) throw new Error(`Tex health ${res.status}`);
  return true;
};

/** GET /decisions/{id}/replay — full Decision record for a prior eval. */
export const getDecisionReplay = (decisionId) =>
  request(`/decisions/${encodeURIComponent(decisionId)}/replay`);

/** GET /decisions/{id}/evidence-bundle — hash-chained evidence bundle. */
export const getEvidenceBundle = (decisionId) =>
  request(`/decisions/${encodeURIComponent(decisionId)}/evidence-bundle`);

/**
 * POST /decisions/{id}/seal — resolve a held decision by a NAMED human act
 * and seal it into the evidence chain.
 *
 * A held decision is not approved by a spoken "yes" — it is sealed by a named
 * human act the evidence layer can prove. This writes the operator's
 * approve / hold / refuse choice as its own hash-chained, post-quantum-signed
 * evidence row and returns the anchor the operator walks away with:
 *
 *   {
 *     decision_id, human_verdict, resolved_by, sealed_at,
 *     evidence_id, anchor_sha256, previous_hash,
 *     pq_signature: {
 *       algorithm, key_id, signature_b64, public_key_b64, signed_at,
 *       post_quantum            // true only when the seal is ML-DSA-backed
 *     } | null
 *   }
 *
 * ``verdict`` is the human verdict on the hold — "approved" / "held" /
 * "refused". ``resolvedBy`` is the operator identity sealed into the record.
 */
export const sealDecision = (decisionId, { verdict, resolvedBy, note } = {}) =>
  request(`/decisions/${encodeURIComponent(decisionId)}/seal`, {
    method: "POST",
    body: JSON.stringify({
      verdict,
      resolved_by: resolvedBy || "operator",
      note: note ?? null,
    }),
  });

/* ------------------------------------------------------------------ */
/* Learning — the calibration hold (Layer 6).                          */
/*                                                                     */
/* A calibration proposal is the second kind of hold: not a frozen     */
/* action, but Tex asking permission to sharpen its own policy after   */
/* an anytime-valid e-process crossed and an off-policy confidence     */
/* bound cleared. It rides in on the SAME /v1/vigil human_decision     */
/* channel, distinguished only by hold.kind === "calibration".         */
/*                                                                     */
/* Approving / rejecting a proposal IS the sealed human act — these     */
/* endpoints write the operator's choice into the proposal's audit      */
/* trail (its own evidence), so a calibration hold resolves THROUGH     */
/* these, never through /seal. "Keep holding" writes nothing: the       */
/* proposal lapses on supersession when a newer crossing replaces it.   */
/* ------------------------------------------------------------------ */

/**
 * POST /v1/learning/proposals/{id}/approve — accept the calibration and
 * activate the new policy snapshot. Returns the applied proposal. The
 * approver identity is sealed into the record; the key carries the tenant.
 */
export const approveProposal = (proposalId, { approver } = {}) =>
  request(
    `/v1/learning/proposals/${encodeURIComponent(proposalId)}/approve`,
    {
      method: "POST",
      body: JSON.stringify({ approver: approver || "operator" }),
    }
  );

/**
 * POST /v1/learning/proposals/{id}/reject — decline the calibration with a
 * structured reason (required by the contract). The rejection is sealed into
 * the proposal's audit trail. Tex keeps the current policy.
 */
export const rejectProposal = (proposalId, { rejecter, reason } = {}) =>
  request(
    `/v1/learning/proposals/${encodeURIComponent(proposalId)}/reject`,
    {
      method: "POST",
      body: JSON.stringify({
        rejecter: rejecter || "operator",
        reason: reason || "declined by operator",
      }),
    }
  );

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
      tenant_id: scopedTenant(tenantId) ?? null,
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

/**
 * GET /v1/speak/timed?text=... — the SAME sealed line in Tex's ONE voice, but
 * returned as JSON WITH per-word timing so the on-screen text can light up in
 * step with the voice:
 *   { backend, sample_rate, audio_b64 (raw s16le PCM), words:[{text,start,end}] }
 *
 * Word timing is an ElevenLabs-only capability; when it isn't configured the
 * route answers 503 and the caller falls back to speakStreamUrl — a real voice,
 * just without the highlight. Normal same-origin GET through the proxy (not a
 * streaming socket), so it rides the existing /api/tex/* path unchanged.
 */
export const speakTimedUrl = (text) =>
  `${BASE}/v1/speak/timed?text=${encodeURIComponent(text || "")}`;

export const TEX_API_BASE = BASE;

/* ----------------------------------------------------------------------
 * tex-conduit — "Connect your directory" (read-only Entra admin consent).
 *
 * startEntraConnect() opens a broker connection and returns Microsoft's
 * admin-consent URL. connectEntra() runs the whole one-click flow: open that
 * URL in a popup on Microsoft's OWN screen, let the admin click Accept, and
 * await the sealed result the callback posts back. Tex never holds the
 * credential, and the grant is sealed server-side BEFORE any agent is read.
 * -------------------------------------------------------------------- */
export const startEntraConnect = (tenantId) =>
  request(
    `/v1/surface/conduit/connect/entra/start?tenant_id=${encodeURIComponent(
      tenantId || "organizations"
    )}`,
    { method: "POST" }
  );

export async function connectEntra(tenantId, { timeoutMs = 5 * 60 * 1000 } = {}) {
  let started;
  try {
    started = await startEntraConnect(tenantId);
  } catch (_err) {
    return { connected: false, error: "start_failed" };
  }
  if (!started?.configured || !started?.consent_url) {
    /* No multi-tenant app wired yet — surface the honest not-configured state
       rather than opening a broken popup. */
    return { connected: false, error: "not_configured", started };
  }

  /* The admin approves on Microsoft's own screen, in a popup. */
  const popup = window.open(
    started.consent_url,
    "tex-entra-connect",
    "width=520,height=720,menubar=no,toolbar=no"
  );
  if (!popup) return { connected: false, error: "popup_blocked" };

  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
      clearTimeout(timer);
      resolve(result);
    };
    /* The callback page posts { type:"tex-conduit-connect", connected, tenant,
       next, ... }. Match on the type, not a hardcoded origin (the callback may
       be served from the proxy or the backend origin); the message carries no
       secret, only the connection outcome. */
    const onMessage = (ev) => {
      const d = ev && ev.data;
      if (d && d.type === "tex-conduit-connect") finish(d);
    };
    window.addEventListener("message", onMessage);
    /* If the admin closes the popup without finishing, don't hang forever. */
    const poll = setInterval(() => {
      if (popup.closed) finish({ connected: false, error: "popup_closed" });
    }, 500);
    const timer = setTimeout(
      () => finish({ connected: false, error: "timeout" }),
      timeoutMs
    );
  });
}
