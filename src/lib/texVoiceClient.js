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

import { mintVoiceToken, speakStreamUrl } from "./texApi";

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
/* ------------------------------------------------------------------ */

let _activeAudio = null;

/* Synthesize and play a grounded line in Tex's single voice. Streams
   from the gateway via /v1/speak so first audio is fast. Returns a
   promise that resolves when playback finishes (or immediately, quietly,
   if synthesis is unreachable — Tex does not announce its own plumbing). */
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

/* Demo only: play a pre-rendered clip in Tex's voice from /public/audio/demo.
   The scripted demo speaks AUTHORED lines — exactly the product's doctrine
   (words are authored, never machine-written) — so playing them as audio is
   the product behaving as designed, not a stand-in for it. Same _activeAudio
   slot as texSpeak, so stopSpeaking() cuts a clip mid-play like any line. */
export function texPlayClip(name) {
  if (!name) return;
  stopSpeaking();
  try {
    const audio = new Audio(`/audio/demo/${name}.mp3`);
    audio.preload = "auto";
    _activeAudio = audio;
    audio.onended = () => {
      if (_activeAudio === audio) _activeAudio = null;
    };
    audio.play().catch(() => {});
  } catch {
    /* No audio context (autoplay blocked until first gesture). Stay quiet. */
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
}
