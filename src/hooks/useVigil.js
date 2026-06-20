/**
 * useVigil
 *
 * Subscribes to the live voice and exposes what Tex chose to say. The backend
 * decides; the frontend renders. Two transports, one posture:
 *
 *   1. SSE first (the 2026 SOTA for one-way push). Opens an EventSource to
 *      /v1/vigil/stream and renders each `event: vigil` frame the instant it
 *      arrives — no 30s lag before a held decision surfaces. EventSource gives
 *      automatic reconnect and Last-Event-ID resume for free, over the same
 *      same-origin proxy (which pipes text/event-stream through untouched).
 *
 *   2. Polling fallback. If EventSource is unavailable, or the stream errors
 *      hard enough that the browser stops retrying, we fall back to the steady
 *      30s poll of /v1/vigil. The surface never knows which transport is live.
 *
 * Three rules, unchanged — the vigil's whole posture is calm:
 *
 *   1. No loading state is ever surfaced. Before the first frame, the consumer
 *      renders a posture-forward ready line. Tex without a response yet is
 *      still Tex; it just hasn't spoken this session.
 *
 *   2. No error state is ever surfaced. On any failure the last good response
 *      stays in state and the transport retries underneath. Tex never says
 *      "connection lost"; it keeps speaking the most recent truth it chose.
 *      Silence is Tex's failure mode — not a toast.
 *
 *   3. State updates only on change. A frame whose JSON equals the last frame
 *      is dropped before it reaches React, so an unchanged vigil never causes
 *      a re-render or disturbs the sentence rotation.
 */

import { useEffect, useRef, useState } from "react";
import { getVigil, vigilStreamUrl } from "../lib/texApi";

const POLL_INTERVAL_MS = 30_000;

export function useVigil(tenantId) {
  const [vigil, setVigil] = useState(null);
  const lastJsonRef = useRef(null);
  const esRef = useRef(null);
  const pollRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    lastJsonRef.current = null;

    /* Nothing to watch until a real directory is connected. No tenant → no
       poll, no stream; the surface rests in silence. This is the guarantee
       that a default/simulated backend estate can never leak onto the glass:
       the vigil only ever speaks for a tenant the operator explicitly
       connected. */
    if (!tenantId) {
      setVigil(null);
      return () => {
        cancelledRef.current = true;
      };
    }

    /* Render only on genuine change — keeps the rotation steady and avoids
       React churn under a chatty stream. */
    const commit = (next, rawJson) => {
      if (cancelledRef.current || next == null) return;
      const json = rawJson ?? JSON.stringify(next);
      if (json === lastJsonRef.current) return;
      lastJsonRef.current = json;
      setVigil(next);
    };

    const startPolling = () => {
      if (pollRef.current) return; // already polling
      const tick = async () => {
        try {
          const next = await getVigil(tenantId);
          commit(next);
        } catch {
          /* Silent. Last good response stays in state. */
        }
      };
      tick();
      pollRef.current = setInterval(tick, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    /* Prefer SSE. EventSource is GET-only and same-origin here, so the proxy
       attaches the key server-side exactly as it does for the poll. */
    const canStream = typeof window !== "undefined" && "EventSource" in window;

    if (canStream) {
      try {
        const es = new EventSource(vigilStreamUrl(tenantId));
        esRef.current = es;

        const onVigil = (evt) => {
          try {
            const next = JSON.parse(evt.data);
            commit(next, evt.data);
          } catch {
            /* Ignore a malformed frame; the next one will be clean. */
          }
        };
        es.addEventListener("vigil", onVigil);
        /* Some servers emit unnamed events; accept those too. */
        es.onmessage = onVigil;

        es.onopen = () => {
          /* Stream is healthy — stand down the fallback poll if it was up. */
          stopPolling();
        };

        es.onerror = () => {
          /* EventSource retries on its own (readyState CONNECTING). Only if
             the browser gave up entirely (CLOSED) do we fall back to polling
             so the voice never goes dark. */
          if (es.readyState === EventSource.CLOSED) {
            startPolling();
          }
        };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      cancelledRef.current = true;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      stopPolling();
    };
  }, [tenantId]);

  return vigil;
}
