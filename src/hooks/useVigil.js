/**
 * useVigil
 *
 * Fetches /v1/vigil on mount, polls every 30 seconds, exposes what Tex
 * chose to say to the surface. This is the live voice — the backend
 * decides; the frontend renders.
 *
 * Three rules, the same posture as the rest of the vigil:
 *
 *   1. No loading state is ever surfaced. While the first fetch is in
 *      flight, the consumer renders a posture-forward ready line. Tex
 *      without a response yet is still Tex; it just hasn't spoken this
 *      session.
 *
 *   2. No error state is ever surfaced. If a poll fails, the last good
 *      response stays in state and the next interval tries again. Tex
 *      never says "connection lost"; Tex keeps speaking the most recent
 *      truth it chose.
 *
 *   3. Polling is steady, not exponential. The vigil's whole posture is
 *      calm — backing-off jitter would make the heartbeat uneven.
 *      Steady 30s, underneath the sentence rotation.
 */

import { useEffect, useRef, useState } from "react";
import { getVigil } from "../lib/texApi";

const POLL_INTERVAL_MS = 30_000;

export function useVigil(tenantId) {
  const [vigil, setVigil] = useState(null);
  const intervalRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const tick = async () => {
      try {
        const next = await getVigil(tenantId);
        if (!cancelledRef.current) setVigil(next);
      } catch (_err) {
        /* Silent. The last good response stays in state. */
      }
    };

    tick();
    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [tenantId]);

  return vigil;
}
