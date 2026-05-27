/**
 * useSystemState
 *
 * Fetches /v1/system/state on mount, polls every 30 seconds, exposes
 * the snapshot to Tex's voice layer.
 *
 * Three rules:
 *
 *   1. No loading state is ever surfaced to the operator. While the
 *      first fetch is in flight, the consumer can render the
 *      no-knowledge variant of every sentence (texVoice's speak(null)).
 *      Tex without data is still Tex — it just hasn't met your agents
 *      yet.
 *
 *   2. No error state is ever surfaced to the operator. If a poll
 *      fails (network, timeout, backend 5xx), we keep the last good
 *      snapshot and try again on the next interval. Tex doesn't say
 *      "connection lost." Tex says the most recent truth it knows.
 *
 *   3. Polling is steady, not exponential. The vigil's whole position
 *      is calm — backing-off jitter would make the data heartbeat
 *      uneven. Steady 30s. If the operator hovers a sentence and the
 *      vigil pauses, the poll keeps going underneath. The display
 *      pauses; the truth doesn't.
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
