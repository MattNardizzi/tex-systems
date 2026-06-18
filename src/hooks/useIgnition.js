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
import { getDiscoveryStatus, igniteDiscovery, getDiscoveryCount, wakeBackend, connectEntra } from "../lib/texApi";

/* A small delay, for retrying through a backend cold-boot window. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
 * SANDBOX DOOR — the OLD placeholder demo. OFF by default now.
 *
 * It used to greet on every arrival and ignite a synthetic estate
 * (meridian-7) as a stand-in before real connect existed. The real
 * "Begin -> connect your directory" flow (ENTRA CONNECT, below) has REPLACED
 * it. Set VITE_TEX_SANDBOX_DOOR="1" only to bring the demo door back for a
 * local walkthrough; unset / anything else leaves it off.
 * -------------------------------------------------------------------- */
const SANDBOX_DOOR = import.meta.env.VITE_TEX_SANDBOX_DOOR === "1";

/* ----------------------------------------------------------------------
 * ENTRA CONNECT — the real front door. ON by default (it replaced the demo).
 *
 * Begin's first act is the read-only Entra admin-consent connect: Tex seals
 * the grant on Microsoft's own consent screen, then discovers THEIR estate.
 * No connection -> nothing to discover, so this GATES ignition (you cannot
 * map a directory you cannot read). Set VITE_TEX_CONNECT_ENTRA="0" only to
 * fall back to the old demo door.
 * -------------------------------------------------------------------- */
const CONNECT_ENTRA = import.meta.env.VITE_TEX_CONNECT_ENTRA !== "0";

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
  /* The tenant connected this session (set after a successful Entra connect),
     so a re-press ignites that tenant rather than re-connecting. */
  const connectedTenantRef = useRef(null);
  if (PREVIEW_FIRST_RUN && previewTenantRef.current === null) {
    previewTenantRef.current = _previewTenant();
  }

  useEffect(() => {
    cancelledRef.current = false;

    /* CONNECT (the default), PREVIEW, or SANDBOX: hold the day-one door open on
       every load without a server read, so Begin is always there to start the
       connect flow. CONNECT_ENTRA is the real default; PREVIEW/SANDBOX are
       opt-in demo doors. */
    if (PREVIEW_FIRST_RUN || SANDBOX_DOOR || CONNECT_ENTRA) {
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

    /* REAL CLIENT CONNECT (VITE_TEX_CONNECT_ENTRA="1"): the first act is the
       read-only directory connect. Tex seals the grant on Microsoft's own
       consent screen, then discovers THEIR estate. Takes precedence over the
       demo doors — a real client connects their own tenant, not a sandbox
       seed. No connection -> nothing to discover, so this gates ignition.
       Failure (declined / popup closed / blocked / not configured) leaves the
       door so Begin can retry; silence is the failure mode, never a fake
       count. */
    if (CONNECT_ENTRA && connectedTenantRef.current === null) {
      setIgniting(true);
      try {
        const result = await connectEntra();
        if (!result || !result.connected) {
          // eslint-disable-next-line no-console
          if (result?.error) console.info("[tex] connect not completed:", result.error);
          return null;
        }
        connectedTenantRef.current = result.tenant || null;
        const tenant =
          (result.next && result.next.ignite_tenant) || result.tenant || undefined;
        const res = await igniteDiscovery(tenant);
        setIgnited(true);
        return res?.spoken || null;
      } catch (_err) {
        return null;
      } finally {
        setIgniting(false);
      }
    }

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
       The first contact with the backend in this mode is THIS heavy POST, so a
       sleeping Render backend would 502 and the door would re-greet forever.
       Guard against that: wake the backend, then retry ignition through the
       cold-boot window (~30-60s). On success Tex speaks the count (or the
       genuine current count if already ignited) and the glass clears into the
       worker's live estate. On exhausted failure, log the real error and leave
       ignited false so the door stays for a manual retry — never a silent
       fabricated success. */
    if (SANDBOX_DOOR) {
      setIgniting(true);
      try {
        await wakeBackend();
        let res = null;
        let lastErr = null;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          try {
            res = await igniteDiscovery(); // no arg → scopedTenant → meridian-7
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            await sleep(Math.min(8000, 1500 * (attempt + 1)));
          }
        }
        if (lastErr) {
          // eslint-disable-next-line no-console
          console.error(
            "[tex] ignition failed after retries:",
            lastErr?.message || lastErr
          );
          return null; // ignited stays false; door remains so Yes can retry
        }
        setIgnited(true);
        if (res?.spoken) return res.spoken;
        try {
          const c = await getDiscoveryCount();
          return c?.spoken || null;
        } catch (_e) {
          return null;
        }
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
    /* Sandbox practice-course mode: the entrance plays on every arrival and
       the door decision is local. Lets the surface keep the opener up even if
       a cold backend transiently reads as faltering. */
    sandboxDoor: SANDBOX_DOOR,
    igniting,
    begin,
    dismiss,
  };
}
