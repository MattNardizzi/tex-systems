/**
 * useHeartbeat — the single source of truth for "is Tex alive on the wire."
 *
 * This is NOT cosmetic, and it is not a CSS loop. The resting breath on
 * the surface is driven by this hook and nothing else.
 *
 * The contract of the product is a witness that cannot lie. A liveness
 * signal that animates on a dead backend is therefore the one thing the
 * surface must never ship — it would be Tex lying about being alive, at
 * the center of a thing whose entire pitch is provable honesty. So the
 * breath is wired to a real signal: a steady, lightweight ping to the
 * backend. While the ping returns, Tex is alive and the surface breathes.
 * The instant the wire goes quiet long enough to be certain, `alive`
 * flips to false, the breath stops, and the stillness becomes the first
 * falter signal — the one honest channel left when Tex can no longer
 * speak (no wire, no voice; only the still mark remains to tell you).
 *
 * Two deaths, kept distinct on purpose:
 *   - chain broke, backend still reachable  → Tex SPEAKS (the faltering
 *     line, handled in Vigil). It can still talk, so it confesses.
 *   - wire lost, backend unreachable        → Tex CANNOT speak. The breath
 *     simply stops. The stillness is the alarm. That is this hook.
 *
 * Standalone posture: in a build with no backend reachable, Tex has never
 * had a wire to lose, so it presents as alive. Once a real beat has ever
 * landed, a later loss is a true death and is reported as one.
 */

import { useEffect, useRef, useState } from "react";
import { pingBackend } from "../lib/texApi";

/* Liveness beats faster than the 30s data poll — presence is felt, and
   a witness that takes half a minute to notice it died is not a witness. */
const BEAT_INTERVAL_MS = 8_000;

/* How long the wire must stay quiet before we're willing to call it dead.
   Roughly two-and-a-half missed beats — enough to ride out a single
   dropped request without crying wolf, short enough to be honest fast. */
const STALE_AFTER_MS = 20_000;

export function useHeartbeat(override) {
  /* Optimistic at rest: Tex is presumed awake until the wire proves
     otherwise, the same posture as the rest of the vigil ("Tex says the
     most recent truth it knows"). */
  const [alive, setAlive] = useState(true);

  const everReachedRef = useRef(false);
  const lastBeatRef = useRef(Date.now());
  const cancelledRef = useRef(false);

  useEffect(() => {
    /* Dev override owns the signal when set. */
    if (override === "alive") {
      setAlive(true);
      return;
    }
    if (override === "lost") {
      setAlive(false);
      return;
    }

    cancelledRef.current = false;

    const beat = async () => {
      try {
        await pingBackend();
        if (cancelledRef.current) return;
        everReachedRef.current = true;
        lastBeatRef.current = Date.now();
        setAlive(true);
      } catch {
        if (cancelledRef.current) return;
        /* Never had a backend — standalone. Present as alive; there
           was never a wire to lose. */
        if (!everReachedRef.current) {
          setAlive(true);
          return;
        }
        /* Had a wire, and it's been quiet past the window. This is a real
           death. Stop the breath. */
        if (Date.now() - lastBeatRef.current > STALE_AFTER_MS) {
          setAlive(false);
        }
      }
    };

    beat();
    const id = setInterval(beat, BEAT_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [override]);

  return alive; /* true → breathing. false → still (the witness is gone). */
}
