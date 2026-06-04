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
TEX_SANDBOX=1 uvicorn tex.main:app --port 8000
```

This populates the synthetic Meridian estate behind the real discovery
pipeline. Nothing is "ignited" yet — Tex is waiting to be told to begin.

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
python -m tex.sim live reference --onboard standard
```

Every action the agents take hits the real PDP and comes back PERMIT, ABSTAIN,
or FORBID, each sealed into the hash-chained evidence ledger. When Tex holds
something — an agent reaching past what it was blessed to do — that hold
surfaces in the vigil, spoken, unprompted.

(`run reference` does a finite, asserted pass instead; `live` keeps the estate
moving at wall-clock pace, which is what you want to watch. `--onboard standard`
verifies the governed cohort to a trust tier so benign actions actually PERMIT
rather than being held — without it the cold path holds almost everything.)

---

## Notes

- **Order is forgiving.** If the driver starts first it may ignite the tenant
  itself; then tex.systems opens straight into the live vigil (Tex has already
  begun) instead of showing the door. To get the door back, restart the
  backend — "has Tex begun?" is server-authoritative and resets with the
  process, not with your browser.
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
