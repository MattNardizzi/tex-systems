/**
 * presence.js — normalize the /v1/ask response into what the glass renders.
 *
 * DOCTRINE (CLAUDE.md): backend decides, frontend renders. This module computes
 * NOTHING about credibility. It READS the backend's real signals and maps them to
 * the labels the surface shows. The credibility TIER is the gate's REAL verdict,
 * surfaced honestly — it is never a confidence number the UI invented.
 *
 * Two shapes, one normalized result:
 *
 *   1. The forward PRESENCE ENVELOPE (new, OPTIONAL) — res.presence = {
 *        spoken_text, claims, verdicts, prosody_plan, surface_object,
 *        overall_tier
 *      }. The richer contract the backend is growing into (per COORDINATION the
 *      voice gate dict is the live carrier for per-claim faithfulness). When it is
 *      present, overall_tier IS the tier, and claims/verdicts carry the per-claim
 *      evidence a claim links to.
 *
 *   2. The CURRENT AskResponse — { answer, object, proof_ref, attestation }.
 *      attestation.verdict (PERMIT / FORBID / ABSTAIN) is the gate's real verdict,
 *      so the tier is DERIVED from it: a rendering of a verdict that already
 *      exists, never a fabricated score. This is why the tier works against
 *      today's backend, before the envelope ships — and why it can never claim
 *      more credibility than the gate actually granted.
 */

export const TIER = {
  SEALED: "SEALED", // the answer rests on one named sealed fact
  DERIVED: "DERIVED", // composed across sealed facts (no single anchor)
  ABSTAIN: "ABSTAIN", // Tex could not ground it — it abstains (or refuses)
};

const TIER_SET = new Set([TIER.SEALED, TIER.DERIVED, TIER.ABSTAIN]);

/* The tier word the badge shows, and the one honest line that says what it
   MEANS — so the tier reads as a credibility signal, not a cryptic label. This is
   chrome about the answer, never the answer's meaning (that is spoken). */
export const TIER_LABEL = {
  [TIER.SEALED]: "sealed",
  [TIER.DERIVED]: "derived",
  [TIER.ABSTAIN]: "abstained",
};
export const TIER_GLOSS = {
  [TIER.SEALED]: "grounded in a sealed fact",
  [TIER.DERIVED]: "derived from sealed facts",
  [TIER.ABSTAIN]: "unproven — Tex won't claim it",
};

/* A bare hex digest reads as a hash handle; anything else is a name. */
const looksLikeHash = (s) => /^[0-9a-f]{16,}$/i.test(String(s || "").trim());

/* Normalize any evidence reference — a string digest, or an object carrying a
   sha256 under one of several plausible keys — into the { value, kind } handle the
   object surface already knows how to hold. Returns null when there is nothing
   real to point at; we never fabricate an anchor. */
function normEvidence(x) {
  if (!x) return null;
  if (typeof x === "string") {
    const v = x.trim();
    return v ? { value: v, kind: looksLikeHash(v) ? "hash" : "name" } : null;
  }
  if (typeof x === "object") {
    const v =
      x.value ||
      x.sha256 ||
      x.anchor_sha256 ||
      x.evidence_sha256 ||
      (x.proof_ref && x.proof_ref.sha256) ||
      null;
    if (!v) return null;
    return {
      value: String(v),
      kind: x.kind || (looksLikeHash(v) ? "hash" : "name"),
    };
  }
  return null;
}

function normTier(raw) {
  const t = String(raw || "").toUpperCase();
  return TIER_SET.has(t) ? t : null;
}

/* Derive the tier from the gate's REAL verdict when the envelope did not state
   one. PERMIT that names one sealed object → SEALED; PERMIT synthesized across a
   dimension's facts → DERIVED; FORBID / ABSTAIN (no grounded answer) → ABSTAIN.
   A 1:1 read of the verdict, never a confidence guess. No verdict on the wire →
   null, so the badge stays off rather than asserting a tier we cannot stand behind. */
function deriveTier(res) {
  const v = String(res?.attestation?.verdict || "").toUpperCase();
  if (!v) return null;
  if (v === "PERMIT") {
    return res?.attestation?.routed_dimension === "record"
      ? TIER.SEALED
      : TIER.DERIVED;
  }
  return TIER.ABSTAIN; // FORBID + ABSTAIN: Tex returned no grounded claim
}

/* Build the render-ready claim list. Envelope: one entry per claim, merged with
   its parallel verdict for the per-claim tier + evidence anchor. Legacy: there are
   no structured claims, so the list is empty and the single proof handle (below)
   carries the claim→evidence link instead. */
function normClaims(env) {
  if (!env || !Array.isArray(env.claims)) return [];
  const verdicts = Array.isArray(env.verdicts) ? env.verdicts : [];
  return env.claims
    .map((claim, i) => {
      const v = verdicts[i] ?? null;
      const text =
        typeof claim === "string"
          ? claim
          : claim?.text || claim?.token || claim?.claim || null;
      const tier =
        normTier(typeof v === "string" ? v : v?.tier || v?.verdict) ||
        normTier(claim?.tier);
      const evidence =
        normEvidence(claim?.evidence ?? claim) ||
        normEvidence(v && (v.evidence ?? v));
      return { text, tier, evidence };
    })
    .filter((c) => c.text || c.evidence);
}

/**
 * derivePresence(res) → the normalized presence the glass renders, or null.
 *
 *   {
 *     spokenText,   // the line Tex speaks AND shows (transient)
 *     tier,         // "SEALED" | "DERIVED" | "ABSTAIN" | null
 *     tierReason,   // ABSTAIN gloss override from the envelope, else null
 *     object,       // { value, kind } | null — the answer's payload handle
 *     claims,       // [{ text, tier, evidence:{value,kind}|null }] (envelope only)
 *     proof,        // { value, kind } | null — single legacy proof anchor
 *     prosody,      // the prosody_plan, carried verbatim (not yet rendered)
 *   }
 */
export function derivePresence(res) {
  if (!res) return null;
  const env = res.presence || null;

  const spokenText = (env?.spoken_text || res.answer || "").trim();
  if (!spokenText) return null;

  const tier = normTier(env?.overall_tier) || deriveTier(res);
  const object =
    normEvidence(env?.surface_object) || normEvidence(res.object) || null;
  const claims = normClaims(env);

  /* The legacy claim→evidence link: with no structured claims, the answer's
     evidence is the sealed anchor it already carries (proof_ref, else the
     object). One handle the operator can reach for. */
  const proof =
    claims.length === 0 ? normEvidence(res.proof_ref) || object : null;

  /* The ABSTAIN gloss — an explicit reason from the envelope when present, else
     null (the spoken line itself already says why Tex abstained). Never invented. */
  const tierReason = tier === TIER.ABSTAIN ? env?.reason || null : null;

  return {
    spokenText,
    tier,
    tierReason,
    object,
    claims,
    proof,
    prosody: env?.prosody_plan || null,
  };
}

/* A compact, single-line label for a claim chip — the claim's own words, clipped
   so a long claim never breaks the row. The full evidence rises as the object
   when the chip is reached for. */
export function claimLabel(claim) {
  const t = (claim?.text || "").trim();
  if (!t) return "the proof";
  return t.length > 52 ? `${t.slice(0, 51)}…` : t;
}
