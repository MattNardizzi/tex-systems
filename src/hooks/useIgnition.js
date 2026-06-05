/**
 * useIgnition
 *
 * Owns the day-one threshold: the one time Tex says hello and offers to
 * begin discovery. The truth of "has Tex begun?" is SERVER-AUTHORITATIVE
 * — it lives in the backend's IgnitionRegistry (fires once per tenant,
 * never replays), not in a forgeable localStorage flag. So on mount this
 * asks the backend with a side-effect-free status read and decides:
 *
 *   - while the read is in flight  → `ready` is false. The surface renders
 *     nothing (empty paper, the resting truth) — never a spinner, and
 *     never a flash of the door for a returning operator.
 *   - ignition has NOT fired       → `doorOpen` is true. Tex greets and
 *     offers "Begin discovery." / "Not yet".
 *   - ignition HAS fired           → `doorOpen` is false. Straight to the
 *     live vigil; Tex has already begun and does not re-introduce itself.
 *
 * begin()   fires ignition (the operator's deliberate act) and returns the
 *           single spoken line — the count, and that Tex is beginning.
 * dismiss() is "Not yet": it closes the door for this session WITHOUT
 *           firing, so ignition stays unfired and Tex greets again next
 *           time. Tex respects "not yet" — it will not nag again now.
 *
 * Posture matches the rest of the surface: no error state is surfaced. If
 * the status read fails (backend asleep, network), the door stays closed
 * and the surface falls through to its calm resting state rather than
 * greeting over a connection it cannot trust.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getDiscoveryStatus, igniteDiscovery, getDiscoveryCount } from "../lib/texApi";

/* ----------------------------------------------------------------------
 * PREVIEW TOGGLE — the day-one threshold, on demand.
 *
 * The real first-run experience fires ONCE per tenant and never again:
 * "has Tex begun?" is server-authoritative (the backend's IgnitionRegistry),
 * not a browser flag, so clearing cookies / incognito will NOT bring it
 * back. That once-only gate is what ships and it is left fully intact
 * below.
 *
 * While reviewing the open, set this to `true` to keep the day-one door
 * AND the ignition line replaying on EVERY load. In this mode nothing is
 * deleted and nothing on the backend is touched — the server's once-only
 * flag is never spent, because begin() speaks locally instead of firing
 * real ignition.
 *
 * Flip back to `false` to restore the real, server-authoritative,
 * fires-once-ever behaviour for ship.
 * -------------------------------------------------------------------- */
const PREVIEW_FIRST_RUN = false;

/* ----------------------------------------------------------------------
 * SANDBOX DOOR — the practice course's recurring entrance.
 *
 * The real first-run is fires-once-ever and server-authoritative (left fully
 * intact below). But the sandbox is a practice course you rehearse: you want
 * "Tex." → "Let's begin mapping." on EVERY start, and you want "Yes" to ignite
 * the deployment's OWN real estate (meridian-7) — not a throwaway — so the
 * glass clears into the worker's living estate and its holds.
 *
 * Set VITE_TEX_SANDBOX_DOOR=1 on Vercel (alongside VITE_TEX_TENANT=meridian-7)
 * to hold the day-one door open on every load and ignite the REAL scoped
 * tenant. The first press runs the full discovery and speaks the count; every
 * later press hits already_ignited (spoken null), so Tex speaks the genuine
 * current count instead and the glass clears into the live estate.
 *
 * This differs from PREVIEW_FIRST_RUN in one decisive way: PREVIEW ignites a
 * fresh throwaway tenant each load (so the count is genuine but the estate is
 * empty and separate), whereas SANDBOX_DOOR ignites the SCOPED tenant — so the
 * interface and the driver watch the same living estate. Empty in ship: the
 * fires-once-ever threshold is never touched.
 * -------------------------------------------------------------------- */
const SANDBOX_DOOR = import.meta.env.VITE_TEX_SANDBOX_DOOR === "1";

/* A fresh tenant per page load. In preview, ignition runs for real against
   this throwaway tenant, so the full discovery pipeline executes and the
   spoken count is genuine — and because the tenant is new each visit, the
   server's fires-once-per-tenant flag never blocks the door from replaying.
   Real operator consoles (PREVIEW_FIRST_RUN = false) omit this entirely and
   ignite once for the deployment's own tenant. */
function _previewTenant() {
  const rand =
    (globalThis.crypto && globalThis.crypto.randomUUID)
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `preview-${rand}`;
}

export function useIgnition() {
  /* null = unknown (still reading); true/false = resolved. */
  const [ignited, setIgnited] = useState(null);
  /* The operator chose "Not yet" this session. */
  const [deferred, setDeferred] = useState(false);
  /* An ignite request is in flight — guards against a double-fire. */
  const [igniting, setIgniting] = useState(false);

  const cancelledRef = useRef(false);
  /* Stable per-page-load preview tenant. */
  const previewTenantRef = useRef(null);
  if (PREVIEW_FIRST_RUN && previewTenantRef.current === null) {
    previewTenantRef.current = _previewTenant();
  }

  useEffect(() => {
    cancelledRef.current = false;

    /* PREVIEW or SANDBOX DOOR: hold the day-one door open on every load
       without a server read — no network, no false-"ignited" from a cold
       backend. PREVIEW ignites a throwaway tenant; SANDBOX_DOOR ignites the
       real scoped tenant (begin(), below). The real server-authoritative read
       is left untouched for ship (PREVIEW_FIRST_RUN = false, no sandbox flag). */
    if (PREVIEW_FIRST_RUN || SANDBOX_DOOR) {
      setIgnited(false);
      return () => {
        cancelledRef.current = true;
      };
    }

    const ac = new AbortController();

    (async () => {
      try {
        const s = await getDiscoveryStatus();
        if (!cancelledRef.current) setIgnited(Boolean(s?.ignited));
      } catch (_err) {
        /* Silence is the failure mode. If we cannot read the wire, do not
           greet over it — resolve to "ignited" so the surface rests in its
           calm state rather than showing a door it cannot honour. */
        if (!cancelledRef.current) setIgnited(true);
      }
    })();

    return () => {
      cancelledRef.current = true;
      ac.abort();
    };
  }, []);

  const begin = useCallback(async () => {
    if (igniting) return null;

    /* PREVIEW: run REAL ignition against a throwaway per-session tenant.
       The backend does the full multi-plane discovery, seals a behavioural
       birth for every agent it finds, and returns the genuine spoken count —
       whatever the scan actually mapped. The fresh tenant means the server's
       once-only flag never blocks the door from replaying next visit. If the
       backend is unreachable, return null: Tex stays silent rather than
       speaking a number it cannot stand behind (silence is the failure mode,
       never a fabricated count). */
    if (PREVIEW_FIRST_RUN) {
      setIgniting(true);
      try {
        const res = await igniteDiscovery(previewTenantRef.current);
        setIgnited(true);
        return res?.spoken || null;
      } catch (_err) {
        setIgnited(true);
        return null;
      } finally {
        setIgniting(false);
      }
    }

    /* SANDBOX DOOR: ignite the REAL scoped tenant (meridian-7), idempotently.
       The first press runs the full discovery and speaks the count; every
       later press hits already_ignited (spoken null), so Tex speaks the
       genuine current count from the pull-only /count endpoint rather than
       falling silent — and the glass clears into the worker's live estate
       either way. */
    if (SANDBOX_DOOR) {
      setIgniting(true);
      try {
        const res = await igniteDiscovery(); // no arg → scopedTenant → meridian-7
        setIgnited(true);
        if (res?.spoken) return res.spoken;
        try {
          const c = await getDiscoveryCount();
          return c?.spoken || null;
        } catch (_e) {
          return null;
        }
      } catch (_err) {
        return null;
      } finally {
        setIgniting(false);
      }
    }

    setIgniting(true);
    try {
      const res = await igniteDiscovery();
      setIgnited(true);
      return res?.spoken || null;
    } catch (_err) {
      /* The operator pressed Begin and the wire failed. Don't claim a
         count we don't have; leave the door so they can try again. */
      return null;
    } finally {
      setIgniting(false);
    }
  }, [igniting]);

  const dismiss = useCallback(() => {
    setDeferred(true);
  }, []);

  return {
    /* The status read has resolved; the surface may render. */
    ready: ignited !== null,
    /* Show the day-one door: resolved, not yet ignited, not deferred. */
    doorOpen: ignited === false && !deferred,
    igniting,
    begin,
    dismiss,
  };
}
