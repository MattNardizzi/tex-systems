# Deploying tex.systems

The live site **www.tex.systems** is a static Vite/React SPA plus one Vercel
serverless function (`api/tex/proxy.js`, the backend proxy). Production is the
`main` branch of `github.com/MattNardizzi/tex-systems`.

There are two deploy paths. **Pick ONE as the source of truth for production**
to avoid two deployments racing on every push (see "Avoid double deploys").

---

## Path A — GitHub Actions (recommended, repo-controlled)

`.github/workflows/deploy.yml` builds in the Actions runner and ships the
prebuilt output to Vercel. This is deterministic: the deploy cannot silently
depend on dashboard build settings.

### One-time setup: add 3 repository secrets

In GitHub: **repo → Settings → Secrets and variables → Actions → New
repository secret**. Add all three:

| Secret              | Where to get it |
| ------------------- | --------------- |
| `VERCEL_TOKEN`      | Vercel → **Account Settings → Tokens** → *Create Token*. Scope it to your team/account; copy the value (shown once). |
| `VERCEL_ORG_ID`     | Vercel → **Team/Account Settings → General**, "Team ID" (a.k.a. Org ID). Or run `vercel link` locally once and read `.vercel/project.json` → `orgId`. |
| `VERCEL_PROJECT_ID` | Vercel → open the project → **Settings → General → Project ID**. Or `.vercel/project.json` → `projectId` after `vercel link`. |

> Fastest way to get the two IDs: in a local checkout run `npx vercel link`
> (authenticate, pick the existing project). It writes `.vercel/project.json`
> containing both `orgId` and `projectId`. `.vercel/` is gitignored.

### How it runs

- Automatically on every push to `main`.
- Manually via **Actions tab → "Deploy to Vercel (production)" → Run
  workflow**.

If the **"Install & build (sanity gate)"** step is red, the code is broken
(fix the build). If a later `vercel …` step is red, it's a Vercel/credential
problem (check the secrets and the dashboard items below).

---

## Path B — Vercel's GitHub integration (what exists today, currently stalled)

Vercel auto-builds `main` on push. This is what broke: pushes reached GitHub
but no new production deployment was produced. Work the checklist below to
repair it. If you adopt Path A, you can leave B on as a fallback **only** if
you prevent double deploys.

### Dashboard repair checklist

Run top to bottom; each step is independent.

**1. Is the Git integration still connected?**
- Vercel → project → **Settings → Git**.
- Confirm the connected repo is `MattNardizzi/tex-systems` and that it does
  **not** say "disconnected" / "install the GitHub App" / "reconnect".
- If disconnected: reconnect, and on GitHub check **Settings → Applications →
  Installed GitHub Apps → Vercel → Configure** has access to this repo.

**2. Is the Production Branch actually `main`?**
- Vercel → project → **Settings → Git → Production Branch**.
- It must be `main`. If it's blank or another branch, set it to `main` and
  save. (If this was wrong, pushes to `main` were treated as non-production
  and never updated the live site.)

**3. Are deployments being created at all, and are builds failing?**
- Vercel → project → **Deployments**.
- Look for a deployment matching commit `7fd0d71` (current `main` HEAD).
  - **No deployment for recent `main` commits** → the trigger is broken
    (steps 1–2, or "Ignored Build Step" / paused project below).
  - **A deployment exists but is "Error"** → open it, read the **Build Logs**.
    Build command should be `vite build` (or framework default), output
    directory `dist`, install `npm install`. Node version 22.x
    (**Settings → General → Node.js Version**).
  - **A deployment exists and is "Ready"** but the site is still old → it's a
    domain/promotion problem → step 4.
- Also check **Settings → Git → Ignored Build Step** is empty/disabled (a
  leftover ignore command can skip every build), and the project isn't
  **Paused** (**Settings → General**).

**4. Is www.tex.systems pinned to an old deployment instead of tracking
production?**
- Vercel → project → **Settings → Domains**.
- `www.tex.systems` (and `tex.systems`) should point to **Production** /
  "follows production", **not** a specific deployment URL.
- If a domain shows it's assigned to a fixed `…-xxxx.vercel.app` deployment,
  reassign it to the latest production deployment (Deployments → the newest
  "Ready" production build → **⋯ → Promote to Production** / **Assign
  Domain**).

**5. Confirm the fix landed (concrete check).**
- Before: the live HTML references `index-CMC-nCA-.js`.
- After a successful deploy of current `main`, that hash **must change**.
- Verify from a terminal:
  ```sh
  curl -s https://www.tex.systems/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'
  ```
  A different hash = the new bundle is live. (Hard-refresh the browser; the
  HTML is served `max-age=0, must-revalidate` so it shouldn't stick, but the
  CDN edge may need a few seconds.)

---

## Avoid double deploys

If **both** Path A (Actions) and Path B (Vercel Git integration) are active,
every push to `main` triggers two production deploys that race. Once Path A is
confirmed working, disable Vercel's automatic Git deploys for `main` by adding
this to `vercel.json` (repo-controlled, preferred):

```json
"git": { "deploymentEnabled": { "main": false } }
```

Do this **only after** the Actions workflow has shipped at least once
successfully — otherwise you'd turn off the only working path.

---

## vercel.json — verified correct

```json
{
  "rewrites": [
    { "source": "/api/tex/:path*", "destination": "/api/tex/proxy?__path=:path*" },
    { "source": "/((?!api/).*)", "destination": "/" }
  ]
}
```

- The API rewrite forwards any-depth `/api/tex/*` to the single
  `api/tex/proxy.js` function (which rebuilds the path from `__path`).
- The SPA rewrite sends everything **except** `/api/*` to `/` (index.html) for
  client-side routing. The negative lookahead keeps API calls from being
  swallowed, so rewrite order is safe.
- No `outputDirectory`/`buildCommand` needed: Vercel detects the Vite preset
  (output `dist`). Keep the project's **Framework Preset = Vite** in the
  dashboard.
