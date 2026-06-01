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
import { getDiscoveryStatus, igniteDiscovery } from "../lib/texApi";

export function useIgnition() {
  /* null = unknown (still reading); true/false = resolved. */
  const [ignited, setIgnited] = useState(null);
  /* The operator chose "Not yet" this session. */
  const [deferred, setDeferred] = useState(false);
  /* An ignite request is in flight — guards against a double-fire. */
  const [igniting, setIgniting] = useState(false);

  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
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
