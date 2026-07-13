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
import {
  igniteDiscovery,
  getDiscoveryCount,
  getDiscoveryStatus,
  wakeBackend,
} from "../lib/texApi";

/* A small delay between count retries, for riding out a cold-boot / still-
   scanning window without leaving the glass white. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The load-time threshold read. The ceremony happens ONCE per estate: the
   durable server status tells us whether Tex has already begun, so a returning
   operator lands straight on the live vigil and never re-watches the opening.

   STATUS_ATTEMPTS / STATUS_RETRY_MS ride out a cold-booting free-tier backend
   (~2 retries over ~10s) before we're willing to call the wire dead — a spun-
   down Render server must not be mistaken for "down" and shown the ceremony.
   DOWN_RECHECK_MS is the quiet cadence we keep probing on once we HAVE resolved
   to down, so the moment the backend answers the surface resolves properly. */
const STATUS_ATTEMPTS = 3;
const STATUS_RETRY_MS = 5_000;
const DOWN_RECHECK_MS = 8_000;

/* Read the durable ignition status with NO tenant — the load-time read must be
   KEYED so the key resolves the estate (passing a tenant_id in prod 403s;
   scopedTenant omits it there). Resolves { ignited, ignited_at } or throws when
   the wire is unreachable. */
const readIgnitionStatus = () => getDiscoveryStatus();

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
  /* The backend was unreachable at load: a first-class, quiet "Tex is down"
     resolution. We NEVER show the ceremony to a client whose backend is dead —
     so this stands apart from ignited===false (the honest first-ever run). */
  const [down, setDown] = useState(false);
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
    let recheckId = null;

    /* One durable status read → the three-way resolution. Returns true once it
       has RESOLVED the threshold (ignited or not), false only when the wire
       never answered across the retry window. */
    const resolveOnce = async () => {
      const status = await readIgnitionStatus();
      if (cancelledRef.current) return true;
      /* status.ignited===true  → door never opens, land on the live vigil.
         status.ignited===false → honest first-ever run, the full ceremony.
         The contract guarantees the boolean; anything else is treated as the
         first-run door (the preview passphrase has already been crossed). */
      setDown(false);
      setIgnited(status?.ignited === true);
      return true;
    };

    /* Land on the down surface AND keep quietly re-checking. The instant a
       status read succeeds, resolve properly (ignited → live vigil; not
       ignited → ceremony) and stop probing. ignited stays null behind the
       down line, so the field rests blank-white under it, never the door. */
    const goDownAndWatch = () => {
      if (cancelledRef.current) return;
      setIgnited(null);
      setDown(true);
      recheckId = setInterval(async () => {
        if (cancelledRef.current) return;
        try {
          await resolveOnce();
          if (recheckId) {
            clearInterval(recheckId);
            recheckId = null;
          }
        } catch (_e) {
          /* still unreachable — keep the quiet line and keep watching */
        }
      }, DOWN_RECHECK_MS);
    };

    (async () => {
      /* Cold starts: nudge a spun-down free-tier backend awake, then retry the
         status read briefly before ever resolving to down. A slow boot must not
         read as a dead wire. While this rides out, ignited stays null and the
         field is blank white (silence, not a spinner). */
      for (let attempt = 0; attempt < STATUS_ATTEMPTS; attempt += 1) {
        if (cancelledRef.current) return;
        try {
          await resolveOnce();
          return;
        } catch (_e) {
          if (attempt === 0) wakeBackend(); /* fire-and-forget warm-up */
          if (attempt < STATUS_ATTEMPTS - 1) await sleep(STATUS_RETRY_MS);
        }
      }
      /* The wire never answered across the whole window — Tex is down. */
      goDownAndWatch();
    })();

    return () => {
      cancelledRef.current = true;
      if (recheckId) clearInterval(recheckId);
    };
  }, []);

  const begin = useCallback(async (estateTenant) => {
    if (igniting) return null;
    setIgniting(true);
    try {
      /* Begin lights up the WHOLE discovery layer in one press — no directory
         prompt, no popup, no gate. It ignites the full multi-plane sweep
         directly; an agent is found wherever it leaves a footprint, and the
         spoken line carries the honest coverage — the count, plus the planes
         still dark and the vantage that would open the biggest one. A directory,
         when connected, is just one plane sourced server-side, never an
         interactive consent on Begin.

         ``estateTenant`` is the estate the SURFACE watches (the caller's
         resolved watch tenant), so ignition and the vigil always speak of one
         estate. It wins over the session-connected directory; with neither,
         the id is omitted and the key (or the backend default) carries it. */
      const spoken = await igniteAndCount(
        estateTenant || connectedTenantRef.current || undefined
      );
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
    /* The backend was unreachable at load — show the quiet "Tex is down" line,
       never the ceremony. Cleared the moment a status read lands. */
    down,
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
