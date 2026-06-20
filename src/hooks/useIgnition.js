/**
 * useIgnition
 *
 * Owns the day-one threshold: the one time Tex says hello and offers to begin.
 * In the connect-your-directory model the threshold is session-scoped — the
 * door is held open until the operator connects a real directory, and Begin's
 * first act IS that connect:
 *
 *   begin()   runs the read-only Entra admin-consent connect, then ignites
 *             discovery against the directory it sealed, and returns the single
 *             spoken line (the count, and that Tex is beginning). No connection
 *             -> nothing to discover, so a failed / declined connect leaves the
 *             door open to retry. Tex never fabricates a count.
 *   dismiss() is "Not yet": it closes the door for this session WITHOUT
 *             connecting, so Tex greets again next time and does not nag now.
 *
 * Posture matches the rest of the surface: no error state is surfaced. A failed
 * connect simply leaves the door; silence is the failure mode, never a toast.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { igniteDiscovery, connectEntra } from "../lib/texApi";

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
      /* Already connected this session: a re-press re-ignites THAT real tenant,
         never the keyless default. */
      if (connectedTenantRef.current !== null) {
        const res = await igniteDiscovery(connectedTenantRef.current || undefined);
        setIgnited(true);
        return res?.spoken || null;
      }

      /* First act: the read-only Entra admin-consent connect. Tex seals the
         grant on Microsoft's own consent screen, then discovers THEIR estate.
         No connection -> nothing to discover, so this gates ignition. Failure
         (declined / popup closed / blocked / not configured) leaves the door so
         Begin can retry; silence is the failure mode, never a fabricated count. */
      const result = await connectEntra();
      if (!result || !result.connected) {
        // eslint-disable-next-line no-console
        if (result?.error) console.info("[tex] connect not completed:", result.error);
        return null;
      }
      connectedTenantRef.current = result.tenant || null;
      const tenant =
        (result.next && result.next.ignite_tenant) || result.tenant || undefined;
      /* Hand the connected tenant to the surface so the vigil starts watching
         THIS real estate — and only this one. */
      setConnectedTenant(tenant || result.tenant || null);
      const res = await igniteDiscovery(tenant);
      setIgnited(true);
      return res?.spoken || null;
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
