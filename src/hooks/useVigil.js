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
 *   2. No error state is ever surfaced — but stale truth is not spoken either.
 *      On a failure the last good response stays up while the transport
 *      retries underneath; if NO proof-of-life arrives for STALE_AFTER_MS
 *      (a vigil frame, a server pulse, a successful poll, or a stream
 *      open), the surface returns to silence. Tex never says "connection
 *      lost" — but it also never keeps repeating yesterday as if it were
 *      now. Silence is Tex's failure mode — not a toast, and not a rerun.
 *
 *   3. State updates only on change. A frame whose JSON equals the last frame
 *      is dropped before it reaches React, so an unchanged vigil never causes
 *      a re-render or disturbs the sentence rotation.
 */

import { useEffect, useRef, useState } from "react";
import { getVigil, vigilStreamUrl } from "../lib/texApi";

const POLL_INTERVAL_MS = 30_000;

/* How long the surface may keep speaking without proof the backend is alive.
   Proof-of-life is ANY of: a vigil frame, a server `pulse` frame (the stream's
   visible heartbeat — "alive, unchanged"), a successful poll (even one whose
   body didn't change), or a fresh stream open. 90s = three missed polls or six
   missed pulses — enough slack for a Render hiccup, short enough that the
   glass never narrates an estate it can no longer see. */
const STALE_AFTER_MS = 90_000;
const STALE_CHECK_MS = 15_000;

export function useVigil(tenantId) {
  const [vigil, setVigil] = useState(null);
  const lastJsonRef = useRef(null);
  const lastAliveRef = useRef(0);
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
       React churn under a chatty stream. Change means the TRUTH changed:
       generated_at is a fresh stamp on every body, so it is stripped before
       comparing — otherwise the 30s poll fallback re-rendered identical
       truth forever and this dedup never fired. (Nothing renders the stamp;
       the newest full object still lands in state whenever truth moves.) */
    const commit = (next) => {
      if (cancelledRef.current || next == null) return;
      const { generated_at: _stamp, ...truth } = next;
      const json = JSON.stringify(truth);
      if (json === lastJsonRef.current) return;
      lastJsonRef.current = json;
      setVigil(next);
    };

    /* Proof-of-life. An unchanged frame or a bare pulse never re-renders,
       but it DOES prove the backend still stands behind what's on the glass —
       so freshness is marked here, not inside commit. */
    const markAlive = () => {
      lastAliveRef.current = Date.now();
    };
    markAlive(); // the clock starts at subscribe, not at the epoch

    /* The staleness bound. When proof-of-life stops for STALE_AFTER_MS, the
       surface returns to silence rather than repeating the last truth as if
       it were current. lastJsonRef is cleared too, so when the SAME truth
       comes back after an outage it re-renders instead of being deduped
       against the utterance we just retired. */
    const staleTimer = setInterval(() => {
      if (cancelledRef.current) return;
      if (lastJsonRef.current == null) return; // already silent
      if (Date.now() - lastAliveRef.current <= STALE_AFTER_MS) return;
      lastJsonRef.current = null;
      setVigil(null);
    }, STALE_CHECK_MS);

    const startPolling = () => {
      if (pollRef.current) return; // already polling
      const tick = async () => {
        try {
          const next = await getVigil(tenantId);
          markAlive(); // a 2xx is proof-of-life even when the body is unchanged
          commit(next);
        } catch {
          /* Silent. Last good response stays up until the staleness bound. */
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
          markAlive();
          try {
            const next = JSON.parse(evt.data);
            commit(next);
          } catch {
            /* Ignore a malformed frame; the next one will be clean. */
          }
        };
        es.addEventListener("vigil", onVigil);
        /* Some servers emit unnamed events; accept those too. */
        es.onmessage = onVigil;

        /* The stream's visible heartbeat: "alive, unchanged". Carries no
           truth to render — only the license to keep rendering the current
           one. A backend that stops pulsing loses that license at the
           staleness bound. */
        es.addEventListener("pulse", markAlive);

        es.onopen = () => {
          /* Stream is healthy — stand down the fallback poll if it was up.
             The server emits the current truth immediately on subscribe, so
             an open is proof-of-life in itself. */
          markAlive();
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
      clearInterval(staleTimer);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      stopPolling();
    };
  }, [tenantId]);

  return vigil;
}
