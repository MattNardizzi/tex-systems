/**
 * seeListener.js — hold-to-speak for the SEE surface.
 *
 * This is deliberately SEPARATE from texVoiceClient.js (the TexListener voice
 * gateway). That gateway is the GROUNDED-ANSWER loop — mic → Tex's own
 * self-hosted recognizer → /v1/ask → /v1/speak — and it is globally MUTED
 * (VOICE_ENABLED = false), so it never opens a mic today. The SEE surface needs
 * only a transcript ("show me the evidence chain"), not a spoken reply, so it
 * rides the browser's OWN speech recognizer instead:
 *
 *   - zero backend, zero per-minute cost, near-instant;
 *   - when the browser supports it, on-device — audio never leaves the device,
 *     which is the sovereignty posture Tex wants;
 *   - the gesture maps 1:1: press → start(), release → stop() → final transcript.
 *
 * It mirrors the TexListener shape (start(onPartial) / stop() → Promise<string>)
 * so the surface treats them the same way, and it degrades the same way: any
 * miss (no API, denied mic, nothing heard) resolves to an empty transcript and
 * Tex stays quiet — never a toast, never a thrown error to the surface.
 *
 * Web Speech is Chrome/Edge-first and its on-device mode is still experimental,
 * so SEE_STT_SUPPORTED is the honest gate the surface checks before offering the
 * spoken path; when it's false the surface falls back to a typed input.
 */

const SR =
  (typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)) ||
  null;

/* Whether this browser can hear at all. The surface reads this to decide
   between the spoken gesture and the typed fallback — honest capability, not an
   assumption. */
export const SEE_STT_SUPPORTED = Boolean(SR);

/* Dev-only diagnostics. In production the recognizer still degrades to silence;
   in dev we surface WHY (a blocked / denied / errored recognizer) so an invisible
   empty transcript is debuggable instead of a mystery. */
const DEV =
  typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;

/* How long stop() waits for the recognizer's final result after the gesture is
   released, before it gives up and returns whatever it has. The release IS the
   end-of-turn, so this only covers the recognizer's own finalization latency. */
const FINALIZE_GRACE_MS = 1600;

export class SeeListener {
  constructor() {
    this._rec = null;
    this._final = "";
    this._interim = "";
    this._best = "";
    this._lastError = null;
    this._onPartial = null;
    this._stopped = false;
    this._endResolve = null;
  }

  /* The transcript to hand back on release: prefer the finalized text, then the
     fullest interim we heard, then whatever partial remains. Never null — "" is a
     valid quiet outcome. THE FIX for the empty-on-release bug: Chrome streams the
     question as INTERIM results and only stamps it "final" on a clean end-of-speech,
     which a quick push-to-talk release routinely races past — so returning only the
     final text dropped real words and the surface fell back to "Here.". */
  _result() {
    return (this._final || this._best || this._interim || "").trim();
  }

  /* Begin listening. Resolves once the recognizer has started (or throws, which
     the caller treats as "no voice this time" and degrades to the typed
     fallback / silence). onPartial receives the live interim transcript for an
     optional on-glass ghost while held. */
  async start(onPartial) {
    if (!SR) throw new Error("see-stt-unsupported");
    this._onPartial = onPartial || null;

    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    /* Continuous, so the recognizer keeps hearing for the WHOLE held gesture and
       never auto-ends mid-question on a short pause — the held press is the turn
       boundary, not the recognizer's own silence detector. The release calls stop()
       to finalize. (This is the configuration verified working in-browser.) */
    rec.continuous = true;
    rec.maxAlternatives = 1;
    /* Use the browser's DEFAULT recognizer (cloud on Chrome) — do NOT force
       on-device. Setting rec.processLocally = true made start() fail outright with
       "language-not-supported" on any machine where the on-device model isn't
       installed: Chrome 139+ exposes the flag, but the model is a separate, usually
       ABSENT download, so the recognizer died instantly, returned nothing, and the
       surface answered "Here." every time. The cloud path needs no setup and works.
       (On-device is still desirable for sovereignty later, but it must first probe
       SpeechRecognition.available() and install() the model, then fall back to cloud
       when unavailable — never request it blind, which is what broke this.) */

    rec.onresult = (event) => {
      let finalAdd = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = (result[0] && result[0].transcript) || "";
        if (result.isFinal) finalAdd += text;
        else interim += text;
      }
      if (finalAdd) this._final = `${this._final} ${finalAdd}`.trim();
      if (interim) this._interim = interim;
      /* Remember the fullest transcript heard so far — final words plus the live
         interim. This is what survives a release that beats the final result, so
         the question is never lost to an empty string. */
      const combined = `${this._final} ${interim}`.trim();
      if (combined) this._best = combined;
      if (this._onPartial) this._onPartial(combined);
    };

    rec.onerror = (event) => {
      /* no-speech / aborted / not-allowed still degrade to "" — silence is the
         honest failure mode, and onend follows to resolve stop(). But capture the
         REASON so a blocked recognizer (an extension or network eating the cloud
         STT request) is diagnosable instead of an invisible empty string. */
      this._lastError = (event && event.error) || "unknown";
      if (DEV) console.warn("[tex-stt] recognizer error:", this._lastError);
    };

    rec.onend = () => {
      if (this._endResolve) {
        const resolve = this._endResolve;
        this._endResolve = null;
        resolve(this._result());
      }
    };

    this._rec = rec;
    rec.start();
  }

  /* End the gesture: signal end-of-turn, wait briefly for the recognizer's final
     transcript, tear down, and resolve the recognized text (or "" if nothing
     came). Never rejects — an empty string is a valid, quiet outcome. */
  async stop() {
    if (this._stopped) return this._result();
    this._stopped = true;
    const rec = this._rec;
    if (!rec) return this._result();

    return new Promise((resolve) => {
      this._endResolve = resolve;
      try {
        rec.stop();
      } catch {
        this._endResolve = null;
        resolve(this._result());
        return;
      }
      /* A recognizer that never fires `end` must not hang the gesture. */
      setTimeout(() => {
        if (this._endResolve) {
          const r = this._endResolve;
          this._endResolve = null;
          try {
            rec.abort();
          } catch {
            /* ignore */
          }
          r(this._result());
        }
      }, FINALIZE_GRACE_MS);
    });
  }
}
