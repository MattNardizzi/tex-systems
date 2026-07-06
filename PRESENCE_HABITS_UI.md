# "I've noticed…" habit surface — mounting notes for S6 (Presence L3)

A thin, self-contained surface for the hypotheses Tex offers from a tenant's own
sealed history. **L3 owns these new files** (it does not edit `Dashboard.jsx` /
`SpokenLine.jsx` / `Vigil.jsx`):

- `src/lib/presenceHabits.js` — the API client (`recallHabits` / `confirmHabit` /
  `declineHabit`), riding the same `/api/tex/*` proxy as `texApi.js` / `presenceProfile.js`.
- `src/components/Dashboard/HabitHypothesis.jsx` (+ `.css`) — one offer card.

## What it does

Tex notices a recurring pattern in THIS tenant's sealed decisions — e.g. *"of the 6
decisions about offshore wires on record, all 6 were forbidden"* — and offers to make
it a standing rule. Each card shows:

- **the offer, in Tex's words** (`phrasing`, computed server-side from the mined counts
  — never an LLM's free invention; the numbers are the mined numbers);
- **the receipts** — `k of n sealed records`, hold-to-see the exact `store:record_id`
  list, so the operator can see this is a count over real evidence;
- **an honest confidence** — `consistency ≥ 0.62`, hover for the full label ("a
  heuristic screen, not a guarantee").

Two affordances:

- **Make it a rule** → `POST /v1/presence/habits/confirm` with the content-addressed
  `hypothesis_id`. The backend re-mines, matches the id, and (if it still holds) seals
  ONE L2 correction capping the subject at `abstain`/`derived`. Tex will then **defer to
  you** on that subject. It can only move Tex toward caution — never make it more
  confident.
- **Not now** → `POST /v1/presence/habits/decline`. Writes nothing; the card dissolves.

The card renders the sealed receipt (content anchor, hold-to-see), then dissolves — the
same "surface, then dissolve" idiom as `ConfirmCorrect`.

## Mounting (S6's call)

Surface habits where it fits the glass — a quiet panel after a session, or beside the
Vigil. Fetch, then render a card per hypothesis:

```jsx
import { useEffect, useState } from "react";
import { recallHabits } from "../../lib/presenceHabits";
import HabitHypothesis from "./HabitHypothesis";

function HabitPanel({ tenantId }) {
  const [hyps, setHyps] = useState([]);
  useEffect(() => {
    recallHabits(tenantId).then((r) => setHyps(r.hypotheses || [])).catch(() => setHyps([]));
  }, [tenantId]);

  if (!hyps.length) return null; // nothing noticed → nothing shown (the honest default)
  return (
    <section className="tex-habit-panel">
      {hyps.map((h) => (
        <HabitHypothesis
          key={h.hypothesis_id}
          hypothesis={h}
          tenantId={tenantId}
          decisionId={h.decision_id /* optional — when present, confirm feeds L1 server-side */}
          onResolved={(kind) => kind === "confirmed" && setHyps((xs) => xs.filter((x) => x !== h))}
        />
      ))}
    </section>
  );
}
```

**An empty list renders nothing.** When the history is thin or noisy the backend
surfaces no hypothesis (no false patterns), so the panel simply does not appear — never
a "no patterns found" placeholder dressed as a feature.

## Response shapes (coordinated with S6)

`recallHabits()` → `{ tenant, count, hypotheses: [ {
  hypothesis_id, subject_key, dimension, dominant_outcome, proposed_tier, phrasing,
  confidence: { n, k, point_rate, wilson_lower, family_size, label },
  supporting: [ { record_id, record_hash, store } ], decision_id? } ] }`.

`confirmHabit()` → the L2 correction receipt (see `PRESENCE_PROFILE_UI.md`):
`{ record_id, anchor_sha256, store: "presence_profile", subject_key, corrected_tier,
operator, created_at, signature: {…|null}, tenant }`.

`declineHabit()` → `{ tenant, hypothesis_id, declined: true }`.

## Auth / ops note

The proxy's key must carry **`decision:write`** for confirm (it seals an L2 correction)
and `decision:read` for recall. The tenant and the operator are resolved **server-side**
from the principal — the browser never names either, and never names the
`subject_key`/`proposed_tier` of a correction: those come only from the server's own
mined, content-addressed hypothesis, so the client can confirm only what Tex currently
offers (a stale or forged `hypothesis_id` will not match and is refused).
