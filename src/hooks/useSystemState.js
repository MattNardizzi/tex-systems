/**
 * useSystemState
 *
 * Fetches /v1/system/state on mount, polls every 30 seconds, exposes
 * the snapshot to Vigil. Its one job now is integrity: the snapshot's
 * chain flags (discovery_chain_intact, snapshot_chain_intact) are what
 * tell Vigil whether Tex can still prove what it has sealed. A broken
 * chain is what flips the surface into the faltering state, where Tex
 * speaks first, unprompted, to confess it can no longer be trusted.
 *
 * Two rules:
 *
 *   1. No loading state is ever surfaced. While the first fetch is in
 *      flight, the surface is simply at rest. Tex without data yet is
 *      still Tex — silence is its resting truth, not a spinner.
 *
 *   2. No error state is ever surfaced. If a poll fails (network,
 *      timeout, backend 5xx), the last good snapshot stays in state and
 *      the next interval tries again. A dropped poll is not a faltering
 *      signal; only a chain the backend reports as broken is. Steady 30s
 *      cadence — the vigil's whole posture is calm.
 */

import { useEffect, useRef, useState } from "react";
import { getSystemState } from "../lib/texApi";

const POLL_INTERVAL_MS = 30_000;

export function useSystemState() {
  const [snapshot, setSnapshot] = useState(null);
  const intervalRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const tick = async () => {
      try {
        const next = await getSystemState();
        if (!cancelledRef.current) {
          setSnapshot(next);
        }
      } catch (_err) {
        /* Silent. The last good snapshot stays in state. */
      }
    };

    /* Fire immediately on mount, then on a steady cadence. */
    tick();
    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return snapshot;
}
