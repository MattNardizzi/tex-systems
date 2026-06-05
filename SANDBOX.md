# Running tex.systems against the simulator

This is the "real client" loop: you start the simulator's estate, open
tex.systems, click **Yes**, and Tex discovers the agents, counts them, takes
them into inventory, becomes the authority, and rules on every action through
FORBID / ABSTAIN / PERMIT with sealed evidence — the held ones surface in the
vigil in Tex's own voice.

tex.systems is only the glass. The discovery, the inventory, and the
governance all happen in the Tex backend. So "run the simulator" means: run
the backend in sandbox mode (that *is* the synthetic estate) and run the
simulator's behaviour driver (that *is* the agents acting). Three terminals,
then one click.

The interface is pre-wired for this in dev: `.env.development` points the dev
proxy at `http://localhost:8000` and names the tenant the simulator uses
(`meridian-7`, the 200-agent reference estate). Vite loads that file only for
`npm run dev`; a production build never sees it.

---

## 1 — Start the Tex backend in sandbox mode

From the Tex backend repo:

```
TEX_SANDBOX=1 TEX_SANDBOX_TENANT=meridian-7 TEX_SANDBOX_SEED=7 \
  PYTHONPATH=src uvicorn tex.main:app --port 8000
```

This populates the synthetic Meridian estate behind the real discovery
pipeline. Nothing is "ignited" yet — Tex is waiting to be told to begin.

`TEX_SANDBOX_TENANT=meridian-7` is the important one: it tells Tex that
`meridian-7` is this deployment's OWN real estate, so pressing **Yes** doesn't
just map it — it enrols the standing watch, switches the live PDP on, and
surfaces holds. Without it, "Yes" maps the estate and then governs nothing, and
no hold ever reaches the glass.

## 2 — Open tex.systems and click Yes

```
npm install
npm run dev
```

Open the dev URL. Tex greets you and offers to begin. Click **Yes**:

- Tex runs the real multi-plane discovery scan against the estate,
- seals a behavioural birth for every agent it finds,
- speaks the count (e.g. *"You have ninety-three agents running. I'll begin."*),
- and from that moment is the authority for this tenant.

## 3 — Let the agents act

From the Tex backend repo, drive the live estate:

```
PYTHONPATH=src python -m tex.sim live reference \
  --wait-for-ignition --drive govern --onboard standard
```

`--wait-for-ignition` means the driver sits silent until YOU press Yes — it
never ignites the tenant itself, so it can't steal the day-one door. The moment
ignition fires it onboards the governed cohort and starts driving.

`--drive govern` is essential: it sends each action through the live
enforcement path (`POST /v1/govern/decide`), whose ABSTAINs are pushed to the
held sink and surface on the glass. The `/evaluate` path (`--drive evaluate`)
seals decisions but never surfaces a hold — you'd see verdicts in the terminal
and nothing on the interface. Every action comes back PERMIT, ABSTAIN, or
FORBID, each sealed into the hash-chained evidence ledger.

`--onboard standard` verifies the governed cohort to a trust tier so benign
actions actually PERMIT rather than being held — without it the cold path holds
almost everything. (`run reference` instead does a finite, asserted pass; `live`
keeps the estate moving at wall-clock pace, which is what you want to watch.)

To run it deployed and unattended for days — a Render Background Worker that
keeps the web service warm and self-heals across restarts — see
**`SANDBOX_LIVE.md`** and **`render.yaml`** in the backend repo.

---

## Notes

- **Recurring entrance (practice course).** The real opener fires once per
  tenant and never again — correct for a live operator, wrong for a rig you
  rehearse. Set **`VITE_TEX_SANDBOX_DOOR=1`** on Vercel (next to
  `VITE_TEX_TENANT=meridian-7`) and the day-one door — "Tex." → "Let's begin
  mapping." → Yes / No — holds open on EVERY start, and **Yes** ignites the
  real `meridian-7` (idempotent): the first press runs discovery and speaks the
  count, later presses speak the genuine current count and drop you straight
  into the worker's live estate. Unset it and the fires-once-ever ship
  behaviour returns untouched. (This is why the opener may not have appeared:
  with the flag off and `meridian-7` already ignited from setup/testing, the
  server-authoritative door correctly suppressed itself. The flag makes that
  irrelevant; the `/reset` endpoint is the one-shot way to re-test the real
  fires-once path.)
- **The driver waits for you.** With `--wait-for-ignition` the driver never
  ignites the tenant itself, so it can start in any order and will not steal the
  day-one door. If the backend restarts mid-run (its ignition flag + inventory
  are in-memory), the driver notices the tenant went un-ignited at its next
  heartbeat and re-asserts ignition + re-onboards on its own.
- **Re-stage the opener** without a redeploy (sandbox only):
  `curl -X POST ".../v1/surface/discovery/reset?tenant_id=meridian-7"`. The
  inventory is kept, so the next Yes re-scans it and the count stays genuine.
- **Scenario ↔ tenant must match.** `reference` = 200 agents under `meridian-7`
  (the default in `.env.development`). `smoke` = 12 agents under `meridian-1`.
  If you run `smoke`, set `VITE_TEX_TENANT=meridian-1` and restart `npm run dev`.
- **The count Tex speaks is the governed cohort, not the raw total.** The scan
  sees ~200 candidates and auto-registers the ones whose capability surface is
  bounded; the rest are held for a human, which is why Tex says it's governing
  ninety-odd and is holding the others.
- **Different backend host?** Set `VITE_TEX_BACKEND=http://host:port` in
  `.env.development`.
- **Production is untouched.** None of these values exist in a `npm run build`
  bundle; deployed tex.systems keeps its keyed, no-tenant-override posture.
