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

/* ------------------------------------------------------------------ */
/* Speaking — Tex's one voice, streamed.                               */
/*                                                                     */
/* Two paths, same voice:                                              */
/*   texSpeak       — the universal fallback: stream /v1/speak into an  */
/*                    <audio> element. Always works (ElevenLabs, the    */
/*                    local Kokoro, or the honest tone), no highlight.  */
/*   texSpeakTimed  — the alive path: fetch /v1/speak/timed (ElevenLabs */
/*                    only) for the audio + per-word timing, play it    */
/*                    through Web Audio on ONE clock, and call onWord    */
/*                    so the on-screen text lights up in step. Falls     */
/*                    back to texSpeak the instant timing is 503/absent. */
/*                                                                     */
/* Everything still degrades to silence: if nothing is reachable, Tex   */
/* stays quiet — it never announces its own plumbing.                  */
/* ------------------------------------------------------------------ */

let _activeAudio = null; // the <audio> fallback element
let _activeSource = null; // the Web Audio source for the timed path
let _activeRaf = null; // the highlight rAF handle
let _voiceCtx = null; // ONE shared AudioContext for the page lifetime

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
      if (_voiceCtx && document.visibilityState === "visible" && _voiceCtx.state === "suspended") {
        _voiceCtx.resume().catch(() => {});
      }
    });
  }
  return _voiceCtx;
}

/* The one-time autoplay unlock. Browsers refuse to play audio until a user
   gesture; call this INSIDE the first real interaction (the first ask/hold, a
   "wake" tap) to resume the shared context and prime it with a silent buffer
   (the WebKit unlock). After this, every later answer/decline/line plays
   programmatically with no further gesture. Returns whether the context is
   running (honest: read state, don't assume). */
export async function unlockVoice() {
  const ctx = _ctx();
  if (!ctx) return false;
  try {
    if (ctx.state === "suspended") await ctx.resume();
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* ignore — state check below is the truth */
  }
  return ctx.state === "running";
}

/* Synthesize and play a grounded line in Tex's single voice. Streams from the
   gateway via /v1/speak so first audio is fast. Returns a promise that resolves
   when playback finishes (or immediately, quietly, if synthesis is unreachable
   — Tex does not announce its own plumbing). */
export async function texSpeak(text) {
  if (!text) return;
  stopSpeaking();
  try {
    const audio = new Audio();
    audio.src = speakStreamUrl(text); // proxied GET → streamed audio body
    audio.preload = "auto";
    _activeAudio = audio;
    await audio.play();
    await new Promise((resolve) => {
      audio.onended = resolve;
      audio.onerror = resolve;
    });
  } catch {
    /* No synthesis reachable. Stay quiet. */
  } finally {
    if (_activeAudio) _activeAudio = null;
  }
}

/* Decode the raw little-endian s16le PCM (base64) the timed endpoint returns
   into the Float32 Web Audio wants. */
function _b64PcmToFloat32(b64) {
  const bin = atob(b64 || "");
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer, 0, len >> 1);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  return f32;
}

/* Speak a sealed line AND drive an in-sync highlight. onWord(index, word) is
   called as each word begins (index -1 clears the highlight); onEnd() fires when
   playback finishes. If the word-timed endpoint is unavailable (503 / no
   ElevenLabs / decode failure) this transparently falls back to texSpeak — same
   voice, no highlight — so callers can always use it. The text passed here is a
   line Tex already sealed; this never authors or alters it. */
export async function texSpeakTimed(text, { onWord, onEnd } = {}) {
  if (!text) return;
  stopSpeaking();
  const ctx = _ctx();
  const done = () => {
    if (onWord) onWord(-1, null);
    if (onEnd) onEnd();
  };
  if (!ctx) {
    await texSpeak(text);
    done();
    return;
  }

  let data;
  try {
    const res = await fetch(speakTimedUrl(text), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("timed-unavailable"); // 503 → fall back
    data = await res.json();
  } catch {
    await texSpeak(text); // real voice, just without the highlight
    done();
    return;
  }

  let src = null;
  try {
    if (ctx.state === "suspended") await ctx.resume();
    const f32 = _b64PcmToFloat32(data.audio_b64);
    if (!f32.length) {
      done();
      return;
    }
    const buf = ctx.createBuffer(1, f32.length, data.sample_rate || 24000);
    buf.copyToChannel(f32, 0);
    src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    _activeSource = src;

    const words = Array.isArray(data.words) ? data.words : [];
    const startAt = ctx.currentTime;
    let lastIdx = -1;
    const tick = () => {
      if (_activeSource !== src) return; // superseded by a newer utterance / stop
      const t = ctx.currentTime - startAt + 0.04; // small lead so it reads in-sync
      let idx = -1;
      for (let i = 0; i < words.length; i++) {
        if (t >= words[i].start) idx = i;
        if (t < words[i].end) break;
      }
      if (idx !== lastIdx) {
        lastIdx = idx;
        if (onWord) onWord(idx, words[idx] || null);
      }
      _activeRaf = requestAnimationFrame(tick);
    };
    _activeRaf = requestAnimationFrame(tick);
    src.start(0);
    await new Promise((resolve) => {
      src.onended = () => resolve();
    });
  } catch {
    await texSpeak(text); // decode/playback failed → universal fallback
  } finally {
    if (_activeRaf) {
      cancelAnimationFrame(_activeRaf);
      _activeRaf = null;
    }
    if (src && _activeSource === src) {
      try {
        src.disconnect();
      } catch {}
      _activeSource = null;
    }
    done();
  }
}

export function stopSpeaking() {
  if (_activeAudio) {
    try {
      _activeAudio.pause();
      _activeAudio.src = "";
    } catch {}
    _activeAudio = null;
  }
  if (_activeRaf) {
    cancelAnimationFrame(_activeRaf);
    _activeRaf = null;
  }
  if (_activeSource) {
    try {
      _activeSource.stop(); // fires onended → resolves any pending playback await
      _activeSource.disconnect();
    } catch {}
    _activeSource = null;
  }
}
