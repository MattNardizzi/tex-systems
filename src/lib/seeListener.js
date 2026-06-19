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

/* How long stop() waits for the recognizer's final result after the gesture is
   released, before it gives up and returns whatever it has. The release IS the
   end-of-turn, so this only covers the recognizer's own finalization latency. */
const FINALIZE_GRACE_MS = 1600;

export class SeeListener {
  constructor() {
    this._rec = null;
    this._final = "";
    this._interim = "";
    this._onPartial = null;
    this._stopped = false;
    this._endResolve = null;
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
    rec.continuous = false;
    rec.maxAlternatives = 1;
    /* Ask for on-device recognition where the browser offers it (Chrome 139+).
       Best-effort: the property is ignored where unsupported, and we never fail
       the start over it. */
    try {
      if ("processLocally" in rec) rec.processLocally = true;
    } catch {
      /* ignore — capability probe only */
    }

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
      this._interim = interim;
      if (this._onPartial) this._onPartial(`${this._final} ${interim}`.trim());
    };

    rec.onerror = () => {
      /* no-speech / aborted / not-allowed all degrade to "" — silence is the
         honest failure mode. onend still fires and resolves stop(). */
    };

    rec.onend = () => {
      if (this._endResolve) {
        const resolve = this._endResolve;
        this._endResolve = null;
        resolve(this._final.trim());
      }
    };

    this._rec = rec;
    rec.start();
  }

  /* End the gesture: signal end-of-turn, wait briefly for the recognizer's final
     transcript, tear down, and resolve the recognized text (or "" if nothing
     came). Never rejects — an empty string is a valid, quiet outcome. */
  async stop() {
    if (this._stopped) return this._final.trim();
    this._stopped = true;
    const rec = this._rec;
    if (!rec) return this._final.trim();

    return new Promise((resolve) => {
      this._endResolve = resolve;
      try {
        rec.stop();
      } catch {
        this._endResolve = null;
        resolve(this._final.trim());
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
          r(this._final.trim());
        }
      }, FINALIZE_GRACE_MS);
    });
  }
}
