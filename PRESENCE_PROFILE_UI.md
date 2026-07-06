# Confirm / Correct control — mounting notes for S6 (Presence L2)

A thin, self-contained two-way loop on a spoken claim. **L2 owns these new files**
(it does not edit `SpokenLine.jsx` / `Dashboard.jsx`):

- `src/lib/presenceProfile.js` — the API client (`correctClaim` / `confirmClaim` /
  `recallProfile` / `revokeProfileFact`), riding the same `/api/tex/*` proxy as
  `texApi.js`.
- `src/components/Dashboard/ConfirmCorrect.jsx` (+ `.css`) — the control.

## What it does

Two affordances next to a claim:

- **✓ Right** → `POST /v1/presence/profile/confirm` — a sealed positive receipt.
  **Non-inflating by construction**: it can never make Tex more confident (there is
  no path that raises a tier). To loosen a prior correction, you revoke it.
- **✗ That's wrong** → `POST /v1/presence/profile/correct` with
  `corrected_tier: "abstain"` — a sealed, citable, **revocable** correction that
  *tightens*: Tex will stop speaking this subject as a sealed fact for this tenant
  and hold it instead. It can only move Tex toward caution — an upward correction is
  refused by the backend (422).

The control shows the sealed receipt (the content anchor, hold-to-see), then
dissolves — the same "surface, then dissolve" idiom as the rest of the glass.

## Mounting (one line, S6's call)

Mount it beside the `SpokenLine` for the claim it covers. From the `/v1/ask`
`presence` envelope (`claims[i]` / `verdicts[i]`):

```jsx
import ConfirmCorrect from "./ConfirmCorrect";

<SpokenLine text={claim.text_span} />
<ConfirmCorrect
  claimId={claim.claim_id}
  tier={verdict.tier}                      // "SEALED" | "DERIVED" | "ABSTAIN"
  decisionId={attestation?.decision_id}    // optional — when present, a correction
                                           //   also feeds calibration server-side
  operator={operatorId}                    // the signed-in human; defaults "operator"
/>
```

For a single-line answer (no per-claim envelope), pass the answer's primary
`claim_id` and the `attestation.verdict`/`overall_tier`.

## Response shape (coordinated with S6)

Every write returns a compact receipt:

```json
{
  "record_id": "pf-<sha256>",
  "anchor_sha256": "<64-hex content anchor>",
  "store": "presence_profile",
  "kind": "correction" | "confirmation",
  "subject_key": "<normalised claim_id>",
  "corrected_tier": "abstain" | "derived" | null,
  "operator": "<who>",
  "created_at": "<iso8601>",
  "signature": { "algorithm": "...", "key_id": "...", "signature_b64": "...",
                 "public_key_b64": "...", "signed_at": "...", "post_quantum": bool } | null,
  "calibration_fed": bool,
  "tenant": "<resolved server-side>"
}
```

`recallProfile()` returns `{ tenant, count, facts: [<receipt-shape>] }`;
`revokeProfileFact(id)` returns `{ tenant, record_id, revoked, calibration_forgotten }`.

## Auth / ops note

The proxy's key must carry **`decision:write`** for confirm/correct/revoke and
`decision:read` for recall (keyless dev = all scopes). The tenant is resolved
server-side from the principal — the browser never names a tenant.
