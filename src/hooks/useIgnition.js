/**
 * useIgnition
 *
 * Owns the day-one threshold: the one time Tex says hello and offers to begin.
 * In the connect-your-directory model the threshold is session-scoped — the
 * door is held open until the operator connects a real directory, and Begin's
 * first act IS that connect:
 *
 *   begin()   lights up the WHOLE discovery layer. Connecting a directory is a
 *             best-effort first act (it lights up the identity plane), NOT the
 *             gate: if the operator connects, Tex watches that tenant; if they
 *             decline / it isn't configured, Begin still ignites the full
 *             multi-plane sweep over every other vantage and returns the single
 *             spoken line — the count plus the honest coverage (where it found
 *             them, and the biggest blind spot). Tex never fabricates a count.
 *   dismiss() is "Not yet": it closes the door for this session WITHOUT
 *             connecting, so Tex greets again next time and does not nag now.
 *
 * Posture matches the rest of the surface: no error state is surfaced. A failed
 * connect simply leaves the door; silence is the failure mode, never a toast.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { igniteDiscovery, getDiscoveryCount } from "../lib/texApi";

/* A small delay between count retries, for riding out a cold-boot / still-
   scanning window without leaving the glass white. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Ignite discovery (idempotent) and ALWAYS resolve to a spoken count. The first
   time, ignite runs the scan and returns the count; once a tenant has ignited it
   returns spoken:null — so fall back to the pull-only count read. Tex must always
   report how many agents it found after a successful connect, never go silently
   white. Retries briefly so a slow / cold-booting backend still yields the
   number rather than the glass clearing to nothing. */
async function igniteAndCount(tenant) {
  try {
    const res = await igniteDiscovery(tenant);
    if (res?.spoken) return res.spoken;
  } catch (_e) {
    /* ignite failed (cold backend?) — fall through to the count read. */
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const c = await getDiscoveryCount(tenant);
      if (c?.spoken) return c.spoken;
    } catch (_e) {
      /* keep trying through the cold-boot / scanning window */
    }
    if (attempt < 3) await sleep(1200);
  }
  return null;
}

export function useIgnition() {
  /* null = unknown (still resolving on mount); true/false = resolved. */
  const [ignited, setIgnited] = useState(null);
  /* The operator chose "Not yet" this session. */
  const [deferred, setDeferred] = useState(false);
  /* An ignite request is in flight — guards against a double-fire. */
  const [igniting, setIgniting] = useState(false);
  /* The REAL tenant the operator connected this session (the Entra directory
     Tex discovered). null until a directory is connected — and that null is
     what keeps the surface watching nothing, rather than a default estate. */
  const [connectedTenant, setConnectedTenant] = useState(null);

  const cancelledRef = useRef(false);
  /* The tenant connected this session, so a re-press ignites that tenant
     rather than connecting again. */
  const connectedTenantRef = useRef(null);

  useEffect(() => {
    cancelledRef.current = false;
    /* Hold the day-one door open on every load (no server read), so Begin is
       always there to start the connect flow. Until a directory is connected
       there is nothing to watch and nothing to greet over. */
    setIgnited(false);
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const begin = useCallback(async () => {
    if (igniting) return null;
    setIgniting(true);
    try {
      /* Begin lights up the WHOLE discovery layer in one press — no directory
         prompt, no popup, no gate. It ignites the full multi-plane sweep
         directly; an agent is found wherever it leaves a footprint, and the
         spoken line carries the honest coverage — the count, plus the planes
         still dark and the vantage that would open the biggest one. A directory,
         when connected, is just one plane sourced server-side, never an
         interactive consent on Begin. */
      const spoken = await igniteAndCount(connectedTenantRef.current || undefined);
      setIgnited(true);
      return spoken;
    } catch (_err) {
      return null;
    } finally {
      setIgniting(false);
    }
  }, [igniting]);

  const dismiss = useCallback(() => {
    setDeferred(true);
  }, []);

  return {
    /* The threshold has resolved; the surface may render. */
    ready: ignited !== null,
    /* Show the day-one door: resolved, not yet ignited, not deferred. */
    doorOpen: ignited === false && !deferred,
    /* The real connected directory the vigil should watch (null until one is
       connected — the surface watches nothing until then). */
    connectedTenant,
    igniting,
    begin,
    dismiss,
  };
}
