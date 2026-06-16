/**
 * texVoiceClient.js — the voice loop, built the way the product demands.
 *
 * The architecture is forced, not chosen. Tex answers grounded ONLY in
 * sealed facts, so a native speech-to-speech model — which reasons and
 * speaks in one pass with no place to put a grounding gate — is
 * disqualified. The loop must be a pipeline with Tex's own backend in
 * the middle:
 *
 *   1. LISTEN   Mic → AudioWorklet (16 kHz PCM) → WebSocket to Tex's
 *               OWN self-hosted speech gateway. Audio never touches a
 *               third party. The gateway runs a self-hosted streaming
 *               recognizer (e.g. NVIDIA Parakeet TDT / Whisper-class on
 *               your GPU). Push-to-talk: the stream opens on press and
 *               is finalized on release. The release IS the end-of-turn,
 *               so there is no voice-activity detector guessing whether
 *               you stopped — the single hardest problem in 2026 voice
 *               is one the held gesture deletes.
 *
 *   2. ANSWER   The final transcript goes to POST /v1/ask through the
 *               same-origin proxy. The backend answers from the sealed
 *               ledger and the six layers — never a free-running LLM.
 *
 *   3. SPEAK    The grounded answer is synthesized in Tex's ONE voice
 *               and streamed back from /v1/speak. Same voice whether Tex
 *               is answering you or telling you it is broken, so Tex
 *               always sounds like one being.
 *
 * Transport note: the recognizer stream is a direct browser→gateway
 * WebSocket (a serverless proxy cannot hold a streaming socket). The
 * gateway is Tex's own infrastructure, inside the same trust domain —
 * not a third party. Auth is a short-lived token minted server-side by
 * GET /v1/voice/token, so no long-lived secret ever reaches the bundle.
 *
 * Everything degrades to silence. If the mic is denied, the gateway is
 * unreachable, or the browser lacks the APIs, the loop resolves with no
 * transcript and Tex stays quiet — silence is the honest failure mode,
 * never a toast.
 */

import { mintVoiceToken, speakStreamUrl, speakTimedUrl } from "./texApi";

const WORKLET_URL = "/tex-mic-worklet.js";

/* ------------------------------------------------------------------ */
/* Listening — open on press, finalize on release.                     */
/* ------------------------------------------------------------------ */

export class TexListener {
  constructor() {
    this._stream = null;
    this._ctx = null;
    this._node = null;
    this._source = null;
    this._ws = null;
    this._finalText = "";
    this._partialCb = null;
    this._ready = false;
    this._closed = false;
  }

  /* Begin capturing and streaming. Resolves once the mic and socket are
     live (or rejects/no-ops on any failure — the caller treats a thrown
     start as "no voice this time" and stays quiet). onPartial receives
     interim transcripts for an optional live ghost while held. */
  async start(onPartial) {
    this._partialCb = onPartial || null;

    /* Capability + permission gate. Any miss → no voice, quietly. */
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !window.AudioContext ||
      !window.WebSocket
    ) {
      throw new Error("voice-unsupported");
    }

    /* Mint a short-lived token + the gateway URL, server-side. */
    const grant = await mintVoiceToken(); // { ws_url, token }
    if (!grant || !grant.ws_url) throw new Error("voice-no-grant");

    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this._ctx = new AudioContext();
    await this._ctx.audioWorklet.addModule(WORKLET_URL);

    /* Open the recognizer socket to Tex's own gateway. */
    const url =
      grant.ws_url + (grant.token ? `?token=${encodeURIComponent(grant.token)}` : "");
    this._ws = new WebSocket(url);
    this._ws.binaryType = "arraybuffer";

    this._ws.onmessage = (evt) => {
      /* Gateway speaks JSON frames: { type: "partial"|"final", text }. */
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "partial" && this._partialCb) {
          this._partialCb(msg.text || "");
        } else if (msg.type === "final") {
          this._finalText = msg.text || this._finalText;
        }
      } catch {
        /* Non-JSON frame — ignore. */
      }
    };

    await new Promise((resolve, reject) => {
      this._ws.onopen = () => resolve();
      this._ws.onerror = () => reject(new Error("voice-ws-error"));
      setTimeout(() => reject(new Error("voice-ws-timeout")), 4000);
    });

    this._source = this._ctx.createMediaStreamSource(this._stream);
    this._node = new AudioWorkletNode(this._ctx, "tex-mic");
    this._node.port.onmessage = (e) => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(e.data); // raw 16-bit PCM frame
      }
    };
    this._source.connect(this._node);
    /* Intentionally NOT connected to destination — no echo of the mic. */
    this._ready = true;
  }

  /* End the gesture. Signals end-of-utterance, waits briefly for the
     gateway's final transcript, tears the mic down completely, and
     resolves the recognized text (or "" if nothing came). */
  async stop() {
    if (this._closed) return this._finalText;
    this._closed = true;

    try {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ type: "end" }));
        /* Give the recognizer a beat to emit the final, then close. */
        await new Promise((r) => setTimeout(r, 350));
      }
    } catch {
      /* ignore */
    }

    this._teardown();
    return this._finalText;
  }

  /* Hard stop — mic and socket gone. The hot-mic contradiction cannot
     survive a released gesture; this is where that is enforced. */
  _teardown() {
    try { this._source && this._source.disconnect(); } catch {}
    try { this._node && this._node.disconnect(); } catch {}
    try { this._ctx && this._ctx.close(); } catch {}
    try {
      this._stream && this._stream.getTracks().forEach((t) => t.stop());
    } catch {}
    try { this._ws && this._ws.close(); } catch {}
    this._source = this._node = this._ctx = this._stream = this._ws = null;
  }
}

/* ================================================================== */
/* Speaking — Tex's one voice, sequenced on the audio clock.           */
/*                                                                     */
/* The day-one bug was an overlap race: texSpeakTimed() awaited a fetch */
/* BEFORE it played, and stopSpeaking() could only stop audio that had  */
/* already started — so a line whose fetch was still in flight could    */
/* never be cancelled. Several lines fired on fixed timers, every fetch */
/* resolved, every one called src.start(), and they all played at once. */
/*                                                                     */
/* The cure is a small non-React speech ENGINE with one invariant:      */
/* strictly one utterance at a time, and a superseded utterance can     */
/* never reach start(). Two mechanisms enforce it (belt + suspenders):  */
/*                                                                     */
/*   • EPOCH (the belt). _epoch is a generation counter. Every speak    */
/*     bumps it and captures its own value; after EVERY await it checks */
/*     myEpoch === _epoch before doing anything audible. An already-    */
/*     resolved fetch cannot be un-resolved by abort() — only this      */
/*     stale-epoch bail keeps a late resolver from playing.             */
/*   • AbortController (the suspenders). Cancels the in-flight fetch     */
/*     (and the prefetch) the instant a new utterance supersedes it.    */
/*                                                                     */
/* Advancement is VOICE-DRIVEN: a sequence plays line N+1 only after    */
/* line N's source actually ends — never on a setTimeout beat — so the  */
/* glass can never drift from what is heard. Words light up off the     */
/* SAME audio clock (AudioContext.currentTime) the playback rides.      */
/*                                                                     */
/* Three paths, ONE voice:                                             */
/*   texSpeak       — universal fallback: stream /v1/speak into <audio>; */
/*                    always works, no highlight.                       */
/*   texSpeakTimed  — one sealed line, played through Web Audio with     */
/*                    per-word timing so the glass lights up in step.    */
/*                    Falls back to texSpeak the instant timing is 503.  */
/*   texSpeakSequence — the opener: a list of sealed lines played one    */
/*                    at a time, each advancing the surface on its own   */
/*                    end, with the next line's audio prefetched while    */
/*                    the current one speaks (gapless, no WebSocket).    */
/*                                                                     */
/* Everything still degrades to silence: if nothing is reachable, Tex   */
/* stays quiet — it never announces its own plumbing.                  */
/* ================================================================== */

const DEV =
  typeof import.meta !== "undefined" &&
  import.meta.env &&
  import.meta.env.DEV;

/* Light a word ~80 ms BEFORE its acoustic onset. The audiovisual binding
   window is asymmetric — the eye forgives a small visual lead far more than a
   lag — so a touch of anticipation reads as "in sync / alive", while lighting
   late reads as laggy and robotic. Tunable 60–120 ms. */
const HIGHLIGHT_LEAD_S = 0.08;
/* A few ms a head of "now" so start() is never scheduled in the past. */
const START_PAD_S = 0.02;
/* An 8 ms gain ramp before a hard cut, so a barge-in never clicks. */
const BARGE_FADE_S = 0.008;
/* The hard ceiling on waiting for synthesis. Tex's backend can be cold (a
   spun-down free tier takes tens of seconds to wake); without a ceiling a
   voice-driven line would wait forever and the opener would FREEZE. When this
   trips, the line gets no audio and the surface advances on its silence floor —
   silence is the honest failure mode, never a frozen screen. Warm backends
   answer in well under a second, so this never fires in the normal path. */
const FETCH_TIMEOUT_MS = 2500;
/* The longest we wait past a clip's known duration for its `ended` event. A
   suspended AudioContext never fires `ended` (its clock is frozen), so this
   watchdog guarantees the sequence still advances instead of hanging. */
const PLAYBACK_GRACE_MS = 1500;

let _voiceCtx = null; // ONE shared AudioContext for the page lifetime
let _epoch = 0; // generation token — the real supersession guard
let _activeSource = null; // the live AudioBufferSourceNode (one-shot)
let _activeGain = null; // its gain node (for the click-free cut)
let _activeAudio = null; // the <audio> element for the plain-stream fallback
let _activeRaf = null; // the word-sync rAF handle
let _activeAbort = null; // AbortController for the in-flight /speak/timed fetch
let _activeEnd = null; // resolver for the current playback await (true = natural end)
let _waitCancel = null; // canceller for an inter-line pacing wait
let _prefetch = null; // { text, controller, promise } — line N+1 warmed during N

function _ctx() {
  if (_voiceCtx) return _voiceCtx;
  const AC =
    typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  _voiceCtx = new AC();
  /* iOS/Safari re-suspends the context on background/lock; re-resume on return
     so Tex can keep speaking without another gesture. */
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (
        _voiceCtx &&
        document.visibilityState === "visible" &&
        _voiceCtx.state !== "running"
      ) {
        _voiceCtx.resume().catch(() => {});
      }
    });
  }
  return _voiceCtx;
}

/* The one-time autoplay unlock. Browsers refuse to play audio until a user
   gesture; call this INSIDE the first real interaction (the "touch to wake"
   tap, the first ask/hold) to prime the shared context. The WebKit unlock — a
   silent one-frame buffer — is started SYNCHRONOUSLY, before any await, because
   older iOS only honors work done directly inside the gesture. After this, every
   later answer/decline/line plays programmatically with no further gesture.
   Returns whether the context is running (honest: read state, don't assume). */
export async function unlockVoice() {
  const ctx = _ctx();
  if (!ctx) return false;
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    /* THEN resume — async is safe once the sync buffer has touched the context. */
    if (ctx.state !== "running") await ctx.resume();
  } catch {
    /* the state check below is the truth */
  }
  return ctx.state === "running";
}

/* A resume guard run at every playback entry — iOS can re-suspend on idle/lock,
   so a one-time unlock is not guaranteed to hold. Raced against a short timeout:
   on a strict browser ctx.resume() called outside a user gesture can stay pending
   forever, and we must never block the opener on it — if it doesn't resolve, we
   proceed and the playback watchdog covers a context that never actually runs. */
async function _ensureRunning(ctx) {
  if (ctx.state === "running") return;
  try {
    await Promise.race([
      ctx.resume(),
      new Promise((r) => setTimeout(r, 1200)),
    ]);
  } catch {
    /* the play attempt will simply be silent — Tex never announces plumbing */
  }
}

/* Supersede whatever is speaking and claim a fresh generation; returns the new
   epoch. Stops audio click-free, aborts the in-flight fetch AND the warmed
   prefetch, cancels the highlight loop and any inter-line wait, and resolves the
   pending playback await as NON-natural (false) so a superseded line never fires
   its onEnd — and therefore never advances a sequence. Bumping _epoch here is the
   whole cure: every already-in-flight fetch bails at its next guard, before it can
   ever reach start(). */
function _supersede() {
  _epoch += 1;
  const mine = _epoch;

  if (_waitCancel) {
    const c = _waitCancel;
    _waitCancel = null;
    c();
  }
  if (_activeAbort) {
    try { _activeAbort.abort(); } catch {}
    _activeAbort = null;
  }
  if (_prefetch) {
    try { _prefetch.controller.abort(); } catch {}
    _prefetch = null;
  }
  if (_activeRaf) {
    cancelAnimationFrame(_activeRaf);
    _activeRaf = null;
  }
  if (_activeAudio) {
    try {
      _activeAudio.onended = null;
      _activeAudio.onerror = null;
      _activeAudio.pause();
      _activeAudio.src = "";
    } catch {}
    _activeAudio = null;
  }
  if (_activeSource) {
    const src = _activeSource;
    const gain = _activeGain;
    const ctx = _voiceCtx;
    _activeSource = null;
    _activeGain = null;
    try { src.onended = null; } catch {}
    try {
      if (ctx && gain) {
        /* Ramp to silence over a few ms, then stop just after — a hard stop()
           mid-waveform clicks; this fade does not. */
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.linearRampToValueAtTime(0.0001, now + BARGE_FADE_S);
        src.stop(now + BARGE_FADE_S + 0.003);
      } else {
        src.stop();
        try { src.disconnect(); } catch {}
      }
    } catch {
      try { src.disconnect(); } catch {}
    }
  }
  if (_activeEnd) {
    const r = _activeEnd;
    _activeEnd = null;
    r(false);
  }
  return mine;
}

/* Hard stop everything Tex is saying. Public barge-in: callers use this before
   they speak something new, and on teardown. */
export function stopSpeaking() {
  _supersede();
}

/* Decode the raw little-endian s16le PCM (base64) the timed endpoint returns into
   the Float32 Web Audio wants. */
function _b64PcmToFloat32(b64) {
  const bin = atob(b64 || "");
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  return f32;
}

/* Fetch the timed payload for one line, ABORTABLE on two triggers: an external
   supersession (via the returned controller) and an internal FETCH_TIMEOUT_MS
   deadline. The deadline is what keeps a cold/dead backend from hanging the
   opener — on timeout the promise rejects with an AbortError the caller treats as
   "no audio, advance". */
function _timedFetch(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, FETCH_TIMEOUT_MS);
  const promise = fetch(speakTimedUrl(text), {
    headers: { Accept: "application/json" },
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) throw new Error("timed-unavailable");
      return res.json();
    })
    .finally(() => clearTimeout(timer));
  return { controller, promise };
}

/* Warm the next line's audio while the current one plays — the SOTA alternative
   to a WebSocket for a known set of short, already-sealed lines (one-shot fetch,
   single-slot cache keyed by exact text, abortable + timeout-bounded). The opener
   feels gapless without putting an LLM in the speaking seat or a socket through
   the serverless proxy. A miss/timeout simply means a fresh fetch or a silent
   line — prefetch can only help, never freeze. */
function _primePrefetch(text) {
  if (!text) return;
  if (_prefetch && _prefetch.text === text) return;
  if (_prefetch) {
    try { _prefetch.controller.abort(); } catch {}
  }
  const { controller, promise } = _timedFetch(text);
  promise.catch(() => {}); // an aborted/failed/timed-out warm-up must not surface as unhandled
  _prefetch = { text, controller, promise };
}

/* Play one sealed line through Web Audio with an in-sync word highlight. Returns
   true only if it played to a NATURAL end at the still-current epoch; false if it
   was superseded or fell through to silence. onWord(index, word) fires as each
   word begins (-1 clears). prefetchNext, if given, is warmed the instant this line
   starts so the next line is ready before it is needed. Falls back to the plain
   stream (real voice, no highlight) on 503 / decode failure — never authoring or
   altering the sealed text. */
async function _speakTimedOne(text, myEpoch, { onWord, prefetchNext } = {}) {
  const ctx = _ctx();
  if (!ctx) return _speakStreamOne(text, myEpoch);
  await _ensureRunning(ctx);
  if (myEpoch !== _epoch) return false;

  /* 1) Get the timed payload — from the warmed prefetch slot if it matches, else
        a fresh fetch. Either way it is abortable AND deadline-bounded (a cold
        backend must never hang the opener). */
  let data;
  try {
    let pf;
    if (_prefetch && _prefetch.text === text) {
      pf = _prefetch;
      _prefetch = null;
    } else {
      pf = _timedFetch(text);
    }
    _activeAbort = pf.controller;
    data = await pf.promise;
    if (myEpoch !== _epoch) return false; // superseded mid-fetch/parse
  } catch (err) {
    if (myEpoch !== _epoch) return false; // aborted by supersession → bail
    /* A timeout/abort (cold or dead backend): give up THIS line's audio and let
       the sequence advance on its silence floor. Do NOT fall back to the plain
       stream — it hits the SAME backend and would hang too. A real 503/network
       error (e.g. ElevenLabs off but Kokoro up) DOES fall back — the stream path
       is itself deadline-bounded, so it cannot hang either. */
    if (err && err.name === "AbortError") return false;
    return _speakStreamOne(text, myEpoch);
  } finally {
    if (myEpoch === _epoch) _activeAbort = null;
  }

  /* 2) Decode the raw s16le PCM → an AudioBuffer at the BACKEND's sample rate
        (the source node resamples to the context rate on playback). */
  let f32;
  try {
    f32 = _b64PcmToFloat32(data.audio_b64);
  } catch {
    f32 = new Float32Array(0);
  }
  if (myEpoch !== _epoch) return false;
  if (!f32.length) return true; // nothing sealed to voice → a (silent) natural end

  /* 3) Schedule playback on the audio clock and drive the highlight off the SAME
        clock, so the lit word can never drift from the heard word. */
  try {
    const buf = ctx.createBuffer(1, f32.length, data.sample_rate || 24000);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    src.connect(gain).connect(ctx.destination);
    _activeSource = src;
    _activeGain = gain;

    const words = Array.isArray(data.words) ? data.words : [];
    const startAt = ctx.currentTime + START_PAD_S;
    /* Track what is HEARD, not what is queued: the output latency (Bluetooth can
       be 150–180 ms) is undefined on Safari/WebKit, so guard it. */
    const outLat = typeof ctx.outputLatency === "number" ? ctx.outputLatency : 0;
    let lastIdx = -2;
    const tick = () => {
      if (_activeSource !== src || myEpoch !== _epoch) return; // superseded
      const t = ctx.currentTime - startAt - outLat + HIGHLIGHT_LEAD_S;
      let idx = -1;
      for (let i = 0; i < words.length; i++) {
        if (t >= words[i].start) idx = i;
        else break; // words are ordered; the last started word is the active one
      }
      if (idx !== lastIdx) {
        lastIdx = idx;
        if (onWord) onWord(idx, words[idx] || null);
      }
      _activeRaf = requestAnimationFrame(tick);
    };

    if (DEV) console.debug(`[texvoice] ▶ "${text}" @${startAt.toFixed(3)}`);

    /* Resolve on the source's natural end OR a watchdog — a SUSPENDED context
       never advances its clock, so `ended` would never fire and the await would
       hang forever (the day-one freeze). The watchdog (clip duration + grace)
       guarantees the sequence advances regardless; on a healthy context `ended`
       fires first and clears it. */
    const durMs = (buf.duration || 0) * 1000 + PLAYBACK_GRACE_MS;
    const natural = await new Promise((resolve) => {
      _activeEnd = resolve;
      let watchdog = setTimeout(() => {
        if (_activeEnd === resolve) {
          _activeEnd = null;
          resolve(true);
        }
      }, durMs);
      src.onended = () => {
        if (_activeEnd === resolve) {
          _activeEnd = null;
          clearTimeout(watchdog);
          resolve(true);
        }
      };
      src.start(startAt);
      if (prefetchNext) _primePrefetch(prefetchNext); // warm N+1 the moment N starts
      _activeRaf = requestAnimationFrame(tick);
    });

    /* Per-line cleanup — only if still current; a supersede already cleaned up. */
    if (myEpoch === _epoch) {
      if (_activeRaf) {
        cancelAnimationFrame(_activeRaf);
        _activeRaf = null;
      }
      if (onWord) onWord(-1, null);
      if (_activeSource === src) {
        try { src.disconnect(); } catch {}
        _activeSource = null;
        _activeGain = null;
      }
      if (DEV) console.debug(`[texvoice] ■ "${text}" (${natural === true ? "ended" : "cut"})`);
    }
    return natural === true;
  } catch {
    if (myEpoch !== _epoch) return false;
    return _speakStreamOne(text, myEpoch); // decode/playback failure → plain voice
  }
}

/* Play one line through the universal <audio> stream (real voice, no highlight).
   Returns true on a natural end at the current epoch, false otherwise. */
async function _speakStreamOne(text, myEpoch) {
  if (myEpoch !== _epoch) return false;
  let played = false;
  let watchdog = null;
  try {
    const audio = new Audio();
    audio.src = speakStreamUrl(text); // proxied GET → streamed audio body
    audio.preload = "auto";
    _activeAudio = audio;
    const ended = new Promise((resolve) => {
      _activeEnd = resolve;
      const settle = (v) => {
        if (_activeEnd === resolve) {
          _activeEnd = null;
          resolve(v);
        }
      };
      audio.onended = () => settle(true);
      audio.onerror = () => settle(false);
      /* Never hang on a stalled/cold media load — a backend that never answers
         would otherwise leave this awaiting forever. */
      watchdog = setTimeout(() => settle(false), FETCH_TIMEOUT_MS + 8000);
    });
    await audio.play().catch(() => {});
    if (myEpoch !== _epoch) return false;
    played = (await ended) === true;
  } catch {
    /* No synthesis reachable. Stay quiet. */
  } finally {
    if (watchdog) clearTimeout(watchdog);
    if (myEpoch === _epoch && _activeAudio) _activeAudio = null;
  }
  return played;
}

/* An interruptible pace between lines. Resolves after ms, or immediately when a
   supersede cancels it (the caller then sees the epoch has moved and bails). */
function _wait(ms, myEpoch) {
  return new Promise((resolve) => {
    if (myEpoch !== _epoch) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (_waitCancel === cancel) _waitCancel = null;
      resolve();
    };
    const id = setTimeout(finish, ms);
    const cancel = () => {
      clearTimeout(id);
      finish();
    };
    _waitCancel = cancel;
  });
}

/* Synthesize and play a grounded line in Tex's single voice through the universal
   stream. Resolves when playback finishes (or immediately, quietly, if synthesis
   is unreachable). */
export async function texSpeak(text) {
  if (!text) return;
  const myEpoch = _supersede();
  await _speakStreamOne(text, myEpoch);
}

/* Speak a sealed line AND drive an in-sync highlight. onWord(index, word) fires as
   each word begins (-1 clears); onEnd() fires when playback finishes NATURALLY —
   not when a newer utterance supersedes this one, so a stale caller never advances.
   If the word-timed endpoint is unavailable (503 / no ElevenLabs / decode failure)
   this transparently falls back to texSpeak — same voice, no highlight. The text
   passed here is a line Tex already sealed; this never authors or alters it. */
export async function texSpeakTimed(text, { onWord, onEnd } = {}) {
  if (!text) return;
  const myEpoch = _supersede();
  await _speakTimedOne(text, myEpoch, { onWord });
  if (myEpoch !== _epoch) return; // superseded → no onEnd
  if (onEnd) onEnd();
}

/* Speak a SEQUENCE of sealed lines strictly one at a time — the day-one opener.
   Each line advances the surface on its OWN end (voice-driven, never a fixed
   beat), the next line's audio is prefetched while the current speaks, and the
   whole run rides a single epoch so a barge-in cancels it cleanly.
     onLineStart(i, text) — mount line i (the glass shows it).
     onWord(i)            — light word i of the current line.
     onLineLeave(i, text) — begin dissolving line i (it has finished + breathed).
     onDone()             — the last line has settled (e.g. reveal Begin).
   Pacing: after a line's voice ends it BREATHES (breathMs), then DISSOLVES
   (leaveMs) before the next mounts. When a line produces NO audio (silence), it
   instead holds silenceHold[i] so the sequence still paces like the designed
   manifesto rather than flashing past. */
export async function texSpeakSequence(lines, opts = {}) {
  const items = (Array.isArray(lines) ? lines : [])
    .map((l) => (typeof l === "string" ? l : l && l.text))
    .filter(Boolean);
  if (!items.length) return;

  const {
    onLineStart,
    onWord,
    onLineLeave,
    onDone,
    silenceHold = [],
    breathMs = 600,
    leaveMs = 700,
  } = opts;

  const myEpoch = _supersede(); // this sequence now owns the voice

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  for (let i = 0; i < items.length; i++) {
    if (myEpoch !== _epoch) return;
    const isLast = i === items.length - 1;
    const startedAt = now();

    if (onLineStart) onLineStart(i, items[i]);

    const played = await _speakTimedOne(items[i], myEpoch, {
      onWord,
      prefetchNext: items[i + 1],
    });
    if (myEpoch !== _epoch) return;

    /* No audio (cold/dead backend, 503): hold the designed silence beat so the
       arc still paces rather than flashing — but only for whatever time the line
       has NOT already been on screen (a fetch timeout may have held it several
       seconds), so a slow failure never stacks the floor on top and drags. */
    if (!played) {
      const floor = silenceHold[i] != null ? silenceHold[i] : 1100;
      const remain = floor - (now() - startedAt);
      if (remain > 0) {
        await _wait(remain, myEpoch);
        if (myEpoch !== _epoch) return;
      }
    }

    /* A breath after Tex finishes the line. */
    await _wait(breathMs, myEpoch);
    if (myEpoch !== _epoch) return;

    if (!isLast) {
      if (onLineLeave) onLineLeave(i, items[i]);
      await _wait(leaveMs, myEpoch); // let the dissolve play before the next mounts
      if (myEpoch !== _epoch) return;
    }
  }

  if (myEpoch === _epoch && onDone) onDone();
}
