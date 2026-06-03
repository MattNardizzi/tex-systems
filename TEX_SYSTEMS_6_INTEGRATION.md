# tex.systems — calibration hold fused into the surface (tex-systems_6)

The product surface now renders the Layer-6 calibration proposal as the second
kind of held card and resolves it through the learning endpoints. Built on the
existing one-screen / one-voice surface; nothing new on the glass at rest.

## What changed

**`src/lib/texApi.js`** — added the learning client:
`approveProposal(id, {approver})` → `POST /v1/learning/proposals/{id}/approve`,
`rejectProposal(id, {rejecter, reason})` → `.../reject`. These are the sealed
human act for a proposal (recorded into its audit trail), so a calibration
hold resolves through them, never through `/seal`.

**`src/components/Dashboard/Vigil.jsx`** — the calibration hold:
- A proposal rides in on the same `/v1/vigil` `human_decision` channel,
  distinguished only by `hold.kind === "calibration"`. The held card renders
  it with the same gesture, the same three verbs, the same seal — the voice
  speaks the meaning (loosen/tighten), the safety bound is the grounding line,
  and the proposed numbers stay a pull-only handle.
- `resolve()` branches on the hold kind: Approve → `approveProposal`, Refuse →
  `rejectProposal` (with reason), Keep holding → no write (it lapses on
  supersession). The decision-hold `/seal` path is untouched.
- **Optimistic, reconciled by the stream.** The card clears the instant you
  act (no spinner — the surface's whole posture) via a session-local dismissed
  set; the next SSE `/v1/vigil` frame is the authoritative truth. Approve/
  refuse make the backend drop the proposal (stays gone); keep-holding writes
  nothing, and the dismissed set is what keeps Tex from re-raising it this
  session (pull-only, never nags). `useTransition` marks the write as
  non-urgent so the dismiss stays responsive.
- **Reach for proof** on a calibration hold speaks the anytime-valid safety
  bound and raises the proposed change (`permit 0.34 → 0.32 …`) as the one
  monospace handle the card may hold, then lets it dissolve — same object
  doctrine as a decision anchor. The in-card handle render also now shows the
  decision anchor on reach (it previously only rendered in the silent state).
- Demo: `DEMO_PROPOSAL` + presenter key **6** + a dev-panel **calibration**
  button summon the hold for walkthroughs (mirrors the `DEMO_ABSTAIN` flow).
  `PRESENTER` is left as it was.

**`src/components/Dashboard/Vigil.css`** — `.tex-object--in-held`: the reached
handle flows under the acts inside the card, keeping the monospace object rise.

## Choice on the React primitive (the SOTA call)

`useOptimistic` is a React 19 hook; this app is on React 18.3.1 stable, where
importing it resolves to `undefined`. The correct-for-this-version pattern is
`useTransition` (stable since 18.0) for the pending boundary plus an optimistic
local dismiss — and because the surface is already SSE-authoritative, the
stream gives reconciliation for free, which is exactly the doctrine here
(backend decides, frontend renders). No React upgrade introduced.

## Verified here

- `npm install` clean (63 packages).
- `npm run build` (Vite 5.4) passes — 42 modules, no errors. The two
  `/fonts/*.woff2` lines are pre-existing runtime-asset notices, not errors.
- Production bundle confirmed to contain the approve/reject endpoints and the
  calibration render path (grepped `dist/assets/*.js`).

## Verify locally / wire notes

- Run it against the live backend: `npm run dev`, summon the hold with key 6
  (demo) or point at a backend whose e-process has fired (real). The proxy
  (`api/tex/[...path].js`) forwards the new learning paths verbatim — no proxy
  change was needed.
- **Scope:** approve/reject require the proxy's `TEX_API_KEY` to carry
  `learning:write` (the keyless dev posture already serves it). Add that scope
  to the production key.
- This pairs with the `tex_10` backend, which serves
  `hold.kind="calibration"` with `proposal_id`, `proposed_change`, and
  `safety_bound` on `/v1/vigil`.
