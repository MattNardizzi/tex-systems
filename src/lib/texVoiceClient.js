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

import {
  mintVoiceToken,
  speakStreamUrl,
  speakStreamTimedUrl,
  speakTimedUrl,
} from "./texApi";

const WORKLET_URL = "/tex-mic-worklet.js";

/* ================================================================== */
/* Master switch — the LITERAL voice, deactivated for now.             */
/*                                                                     */
/* "Literal voice" = the two things that touch audio hardware: Tex     */
/* speaking out loud (TTS — ElevenLabs/Kokoro through the engine        */
/* below) and the mic that hears you (STT — TexListener). While this is */
/* false BOTH are inert: no audio ever plays, no mic ever opens.        */
/*                                                                     */
/* Crucially this is NOT a separate code path — it forces the exact     */
/* "no audio reachable" fallback the engine already handles. A muted    */
/* line reports "did not play", so a sequence (the opener) advances on   */
/* its SILENCE FLOOR (MANIFESTO_BEATS) and still fires every visual      */
/* callback: the words mount, light to full ink, breathe, dissolve, and  */
/* Begin appears — exactly as today, just silent. The mic side throws    */
/* "voice-disabled", which every caller already treats as "no voice this */
/* time" and degrades to the on-glass line / "Here.".                   */
/*                                                                     */
/* To bring the voice back: flip this to true (the gateway + ElevenLabs  */
/* must be wired). Nothing else in the surface needs to change.         */
/* ================================================================== */
/* Env-driven so the muted production DEFAULT is preserved (unset → false), while
   local dev opts in via VITE_VOICE_ENABLED=true in .env.development, and a real
   deploy can flip it on by setting the Vercel env var — no code change, no risk
   of committing a flipped const. */
export const VOICE_ENABLED = import.meta.env.VITE_VOICE_ENABLED === "true";

/* Prime the worklet module's HTTP cache once, off the gesture path, so the
   press never pays its fetch. (audioWorklet.addModule is per-AudioContext, so
   this warms the CACHE, not a context — the cheap, safe half of the warm-up.)
   Gated on VOICE_ENABLED: an unprovisioned deploy must stay perfectly inert. */
let _workletPrimed = false;
function primeWorklet() {
  if (_workletPrimed || !VOICE_ENABLED) return;
  _workletPrimed = true;
  try {
    fetch(WORKLET_URL, { cache: "force-cache" }).catch(() => {});
  } catch {
    /* ignore — a cold cache just means the press pays the fetch, as before */
  }
}

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
    this._finalResolve = null; /* stop() waiting on the gateway's final frame */
  }

  /* Begin capturing and streaming. Resolves once the mic and socket are
     live (or rejects/no-ops on any failure — the caller treats a thrown
     start as "no voice this time" and stays quiet). onPartial receives
     interim transcripts for an optional live ghost while held. */
  async start(onPartial) {
    /* Voice deactivated — no mic opens. The caller already treats a thrown
       start as "no voice this time" and degrades to silence / the on-glass
       line, exactly as it does on a denied or unsupported mic. */
    if (!VOICE_ENABLED) throw new Error("voice-disabled");

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

    /* Mint the short-lived token and open the mic TOGETHER — neither depends
       on the other, and the press is waiting on both. A half-failed start
       must release whatever the other half opened: a live mic with no
       gateway is exactly the hot-mic contradiction _teardown exists to kill. */
    const [grantRes, streamRes] = await Promise.allSettled([
      mintVoiceToken(), // { ws_url, token }
      navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
    ]);
    if (streamRes.status === "fulfilled") this._stream = streamRes.value;
    const grant = grantRes.status === "fulfilled" ? grantRes.value : null;
    if (!grant || !grant.ws_url || !this._stream) {
      this._teardown();
      throw new Error(!grant || !grant.ws_url ? "voice-no-grant" : "voice-no-mic");
    }

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
          /* stop() may be waiting on exactly this frame — release it now
             rather than making every release ride out the full watchdog. */
          if (this._finalResolve) this._finalResolve();
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
        /* Resolve the moment the gateway's "final" frame lands (onmessage) —
           the 350ms is only the WATCHDOG for a gateway that never answers,
           not a toll every release pays. Event-driven, like SeeListener;
           never a fixed sleep. */
        await new Promise((resolve) => {
          this._finalResolve = resolve;
          setTimeout(resolve, 350);
        });
        this._finalResolve = null;
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
/* The hard ceiling on waiting for synthesis. Two real-world latencies push a
   line's /v1/speak/timed well past a second: a cold backend (tens of seconds to
   wake), AND — the one that actually silenced the live opener — the single-worker
   backend periodically WEDGES and queues requests, so a perfectly good 200 (the
   audio IS generated) arrives several seconds late. At 2500 ms those delayed
   responses were aborted before they landed: the words appeared, the audio was
   ready server-side, but the fetch had already given up → a silent opener. 8000 ms
   waits long enough to catch a queued/cold response and PLAY it (the whole point),
   while still bounding a truly dead backend so the line falls through to its
   silence floor instead of freezing. Warm backends answer in well under a second,
   so this never fires in the normal path; the prefetch (line N+1 warmed during N)
   hides most of the wait. */
const FETCH_TIMEOUT_MS = 8000;
/* How long a 503 from /v1/speak/stream_timed benches the streaming path. The
   single-worker backend cold-starts and wedges (see FETCH_TIMEOUT_MS above), so
   a 503 is usually a moment, not a verdict — benching the whole SESSION on one
   (the old behavior) downgraded every later answer to full-clip latency while
   the endpoint sat healthy. Only a 404 (route truly not deployed) is permanent. */
const STREAM_RETRY_MS = 60000;
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
let _activeStream = null; // { stop() } — the chunked streamed-timestamp playback
let _streamTimedDead = false; // 404 once → the endpoint isn't deployed; skip for the session
let _streamTimedRetryAt = 0; // 503 → transient (cold boot / wedge); bench until this timestamp, then re-probe

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
  primeWorklet(); /* off the gesture path: warm the mic worklet's HTTP cache */
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
  if (_activeStream) {
    /* Stop a chunked streamed-timestamp playback: fade + stop every scheduled
       chunk source and abort the in-flight NDJSON reader. */
    const s = _activeStream;
    _activeStream = null;
    try { s.stop(); } catch {}
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

/* ================================================================== */
/* The presence brain — an INSTANT, content-free acknowledgment.        */
/*                                                                     */
/* The moment the operator finishes asking, Tex makes one short sound   */
/* that says "heard you — I'm on it", BEFORE the grounded answer is even */
/* fetched. It is what turns the unavoidable ~1–2 s grounding wait from  */
/* dead air ("broken") into a held beat ("thinking") — the single        */
/* biggest "feels alive" lever, and the fast half of the two-brain split.*/
/*                                                                     */
/* It is FIREWALLED BY CONSTRUCTION — it physically cannot say a fact:   */
/*   • The vocabulary is a FIXED constant (below), never derived from    */
/*     the question, the answer, or any sealed fact. It only signals     */
/*     presence; it asserts nothing.                                     */
/*   • It is PRE-SYNTHESIZED once and cached as a decoded AudioBuffer, so */
/*     playing it is LOCAL (no fetch) and lands in well under 150 ms.     */
/*   • It plays through the SAME engine slot as a real line, so the       */
/*     grounded answer SUPERSEDES it click-free the instant it arrives —  */
/*     the ack covers the gap, the answer cuts in seamlessly.            */
/*                                                                     */
/* (The full design hardens this into a signed/attested asset table; this */
/* is the honest v1 — fixed in source, content-free, pre-rendered.)      */
/* ================================================================== */

/* The fixed presence vocabulary. Content-free BY CONSTRUCTION: each entry only
   acknowledges the reach and signals Tex is working — it says NOTHING about what
   the answer will be. NEVER add a line here that asserts a fact about the estate.

   DISABLED (spoken ack off): kept EMPTY on purpose. Tex no longer says
   "One moment." / "Let me look." The pause is carried by the VISUAL verifying
   beat (the hash / number-grid settling) alone, not by a spoken filler. With no
   entries, prewarm synthesizes nothing and playPresenceAck() no-ops to silence
   by design — every caller stays untouched. */
const PRESENCE_VOCAB = [];

let _presenceBuffers = []; // decoded AudioBuffers for PRESENCE_VOCAB
let _presenceWarmed = false; // one-shot guard so we synthesize the set only once
let _presenceIdx = 0; // rotate through the vocab so it doesn't feel canned

/* Pre-synthesize the presence vocabulary ONCE and cache it decoded, so the ack
   can play with NO network on release. Idempotent — safe to call on every wake.
   A miss (cold backend, decode fail) just means the ack is silent this session;
   the ask still proceeds, Tex simply doesn't get the instant beat. */
export async function prewarmPresence() {
  if (!VOICE_ENABLED || _presenceWarmed) return;
  const ctx = _ctx();
  if (!ctx) return;
  _presenceWarmed = true;
  const bufs = [];
  for (const phrase of PRESENCE_VOCAB) {
    try {
      const res = await fetch(speakStreamUrl(phrase));
      if (!res.ok) continue;
      const arr = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr);
      bufs.push(buf);
    } catch {
      /* this phrase just won't be available; presence degrades to silence */
    }
  }
  _presenceBuffers = bufs;
  if (DEV) console.debug(`[texvoice] ◇ presence warmed (${bufs.length}/${PRESENCE_VOCAB.length})`);
}

/* Play ONE instant, content-free presence ack — the felt "I'm on it". Returns
   true only if a cached buffer actually started. Claims a fresh generation (so it
   stops anything mid-flight, and so the grounded answer can later supersede IT
   click-free). No-ops to silence if not warmed yet — it NEVER blocks the ask. */
export function playPresenceAck() {
  if (!VOICE_ENABLED || !_presenceBuffers.length) return false;
  const ctx = _ctx();
  if (!ctx) return false;
  const phraseIdx = _presenceIdx % _presenceBuffers.length;
  const buf = _presenceBuffers[phraseIdx];
  _presenceIdx += 1;
  _supersede(); // claim the voice; stop anything mid-flight (click-free)
  _ensureRunning(ctx); // fire-and-forget resume; the start below schedules anyway
  try {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    src.connect(gain).connect(ctx.destination);
    _activeSource = src;
    _activeGain = gain;
    src.onended = () => {
      if (_activeSource === src) {
        try { src.disconnect(); } catch {}
        _activeSource = null;
        _activeGain = null;
      }
    };
    src.start(ctx.currentTime + START_PAD_S);
    if (DEV) console.debug(`[texvoice] ◇ presence ack "${PRESENCE_VOCAB[phraseIdx]}"`);
    return true;
  } catch {
    _activeSource = null;
    _activeGain = null;
    return false;
  }
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
function _timedFetch(text, prosody) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, FETCH_TIMEOUT_MS);
  const promise = fetch(speakTimedUrl(text, prosody), {
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
function _primePrefetch(text, prosody) {
  if (!text) return;
  const key = prosody || "";
  if (_prefetch && _prefetch.text === text && _prefetch.prosody === key) return;
  if (_prefetch) {
    try { _prefetch.controller.abort(); } catch {}
  }
  const { controller, promise } = _timedFetch(text, prosody);
  const entry = { text, prosody: key, controller, promise, ready: false };
  /* `ready` marks a SETTLED payload — only a settled warm may short-circuit the
     streaming path in texSpeakSynced (an in-flight one would trade the stream's
     first chunk for a full-synthesis wait). */
  promise
    .then(() => {
      entry.ready = true;
    })
    .catch(() => {}); // an aborted/failed/timed-out warm-up must not surface as unhandled
  _prefetch = entry;
}

/* PUBLIC prewarm for a line Tex is LIKELY to speak next — the speculative ask's
   audio twin. A pure fetch into the single prefetch slot: nothing sounds, no
   epoch moves, no running line is touched; only texSpeakSynced/_speakTimedOne
   can ever voice it, and only for the exact same text+prosody. A warm that is
   never redeemed (revised transcript, superseded turn) is aborted by the next
   supersede or displaced by the next warm — it cannot play. */
export function prewarmSpeak(text, prosody) {
  if (!VOICE_ENABLED || !text) return;
  _primePrefetch(text, prosody);
}

/* Play one sealed line through Web Audio with an in-sync word highlight. Returns
   true only if it played to a NATURAL end at the still-current epoch; false if it
   was superseded or fell through to silence. onWord(index, word) fires as each
   word begins (-1 clears). prefetchNext, if given, is warmed the instant this line
   starts so the next line is ready before it is needed. Falls back to the plain
   stream (real voice, no highlight) on 503 / decode failure — never authoring or
   altering the sealed text. */
async function _speakTimedOne(text, myEpoch, { onWord, prefetchNext, prosody, warmed } = {}) {
  /* Voice deactivated — no audio. Report "did not play" so a sequence advances
     on its silence floor and texSpeakTimed still fires onEnd; the words are
     already on the glass (SpokenLine renders full ink with no active word). */
  if (!VOICE_ENABLED) return false;
  const ctx = _ctx();
  if (!ctx) return _speakStreamOne(text, myEpoch, prosody);
  await _ensureRunning(ctx);
  if (myEpoch !== _epoch) return false;

  /* 1) Get the timed payload — from the warmed prefetch slot if it matches, else
        a fresh fetch. Either way it is abortable AND deadline-bounded (a cold
        backend must never hang the opener). */
  let data;
  try {
    let pf;
    if (warmed) {
      /* A warm detached by texSpeakSynced BEFORE its supersede (which clears
         the slot) — the payload is already local, so this await is instant. */
      pf = warmed;
    } else if (_prefetch && _prefetch.text === text && _prefetch.prosody === (prosody || "")) {
      /* The slot is keyed on text+prosody, so a warm only ever serves the
         EXACT line it was fetched for — a neutral opener warm can never voice
         a verdict-toned answer, nor the reverse. */
      pf = _prefetch;
      _prefetch = null;
    } else {
      pf = _timedFetch(text, prosody);
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
    return _speakStreamOne(text, myEpoch, prosody);
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
    return _speakStreamOne(text, myEpoch, prosody); // decode/playback failure → plain voice
  }
}

/* ================================================================== */
/* The streamed-timestamp path — word-sync at streaming latency.        */
/*                                                                     */
/* /v1/speak/stream_timed relays ElevenLabs' HTTP stream/with-          */
/* timestamps: NDJSON lines pairing raw PCM chunks with the chars they  */
/* speak and their start times. Audio is scheduled GAPLESSLY on the     */
/* shared AudioContext clock the moment each chunk lands — first sound  */
/* in ~hundreds of ms instead of after full synthesis — and the word    */
/* highlight is driven off the SAME clock, live, as timing accumulates. */
/* (Research-verified 2026-07: for a fully-known sealed line the HTTP   */
/* stream beats the input-buffering WebSocket — ElevenLabs' own docs.)  */
/*                                                                     */
/* Returns true on a natural end at the current epoch, false when       */
/* superseded / played partially, and the string "fallback" when NO     */
/* audio was ever scheduled (endpoint missing/unconfigured/unreachable) */
/* so the caller can drop to the full-clip timed path with nothing lost.*/
/* ================================================================== */
async function _speakStreamTimedOne(text, myEpoch, { onWord, prosody } = {}) {
  if (!VOICE_ENABLED) return false;
  const ctx = _ctx();
  if (!ctx) return "fallback";
  await _ensureRunning(ctx);
  if (myEpoch !== _epoch) return false;

  /* Deadline covers connect + first byte only — once chunks flow, the stream
     itself is the pace. */
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(speakStreamTimedUrl(text, prosody), {
      headers: { Accept: "application/x-ndjson" },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (myEpoch !== _epoch) return false;
    /* Timeout (cold/wedged backend): give up this line's audio — the timed
       path hits the SAME backend and would hang too. A plain network error
       (endpoint not deployed, proxy miss) falls back instead. */
    if (err && err.name === "AbortError") return false;
    return "fallback";
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    if (res.status === 404) _streamTimedDead = true;
    else if (res.status === 503) _streamTimedRetryAt = Date.now() + STREAM_RETRY_MS;
    return "fallback";
  }
  if (myEpoch !== _epoch) {
    clearTimeout(timer);
    try { controller.abort(); } catch {}
    return false;
  }
  _activeAbort = controller;

  /* One gain node for the whole stream so a barge-in cuts every scheduled
     chunk click-free at once. */
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const sources = [];
  let stopped = false;
  const streamHandle = {
    stop() {
      stopped = true;
      try { controller.abort(); } catch {}
      try {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.linearRampToValueAtTime(0.0001, now + BARGE_FADE_S);
      } catch {}
      for (const s of sources) {
        try { s.onended = null; } catch {}
        try { s.stop(ctx.currentTime + BARGE_FADE_S + 0.003); } catch {}
      }
    },
  };
  _activeStream = streamHandle;

  let sampleRate = 24000; // header line corrects this before any audio schedules
  let startAt = 0; // audio-clock anchor of stream-time zero (set at first chunk)
  let nextAt = 0; // audio-clock time where the next chunk begins (gapless seam)
  let scheduledDur = 0; // total stream audio scheduled so far (stream-time s)
  const wordStarts = []; // stream-time start of each word (grows while streaming)
  let inWord = false; // persists ACROSS chunks — a word can split over a seam
  let lastCharTime = 0;
  let timeBase = 0; // rebase offset if the vendor frames times chunk-relative
  let sawTimes = false;

  const outLat = typeof ctx.outputLatency === "number" ? ctx.outputLatency : 0;
  let lastIdx = -2;
  const tick = () => {
    if (_activeStream !== streamHandle || myEpoch !== _epoch) return;
    const t = ctx.currentTime - startAt - outLat + HIGHLIGHT_LEAD_S;
    let idx = -1;
    for (let i = 0; i < wordStarts.length; i++) {
      if (t >= wordStarts[i]) idx = i;
      else break; // starts are ordered; the last begun word is the active one
    }
    /* Monotonic: an underrun rebase (scheduleChunk shifting startAt) briefly
       shrinks t, but playback never seeks backward — hold the lit word until
       the audio catches up instead of flashing an earlier one. */
    if (idx > lastIdx) {
      lastIdx = idx;
      if (onWord) onWord(idx, null);
    }
    _activeRaf = requestAnimationFrame(tick);
  };

  const scheduleChunk = (f32) => {
    if (!f32.length) return;
    const buf = ctx.createBuffer(1, f32.length, sampleRate);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    if (!sources.length) {
      startAt = ctx.currentTime + START_PAD_S;
      nextAt = startAt;
      _activeRaf = requestAnimationFrame(tick);
    }
    /* An underrun (a chunk landing after its seam already passed) starts late.
       Advance nextAt from where this chunk ACTUALLY starts — advancing from the
       stale seam would pin every later chunk to "now" while the previous one is
       still playing (overlapping, garbled speech for the rest of the line). The
       highlight anchor shifts by the same gap so wordStarts (stream-time) stay
       aligned with the delayed audio. */
    const at = Math.max(nextAt, ctx.currentTime);
    src.start(at);
    const gap = at - nextAt;
    if (gap > 0) startAt += gap;
    nextAt = at + buf.duration;
    scheduledDur += buf.duration;
    sources.push(src);
  };

  const takeChunk = (msg) => {
    const chars = Array.isArray(msg.chars) ? msg.chars : [];
    const starts = Array.isArray(msg.starts) ? msg.starts : [];
    if (chars.length) {
      /* Rebase if this chunk's clock reset (chunk-relative framing): the
         chunk's audio begins exactly where the already-scheduled audio ends. */
      const first = starts.find((s) => typeof s === "number");
      if (typeof first === "number") {
        if (sawTimes && first + 0.05 < lastCharTime) timeBase = scheduledDur;
        sawTimes = true;
      }
      for (let i = 0; i < chars.length; i++) {
        const ch = String(chars[i] ?? "");
        const isSpace = /^\s*$/.test(ch);
        const st = typeof starts[i] === "number" ? starts[i] + timeBase : null;
        if (!isSpace && !inWord) {
          inWord = true;
          /* SpokenLine counts words on whitespace splits of the SAME sealed
             text these chars mirror (normalization off), so indices line up. */
          wordStarts.push(st != null ? st : lastCharTime);
        } else if (isSpace) {
          inWord = false;
        }
        if (st != null && st > lastCharTime) lastCharTime = st;
      }
    }
    let f32;
    try {
      f32 = _b64PcmToFloat32(msg.audio_b64 || "");
    } catch {
      f32 = new Float32Array(0);
    }
    scheduleChunk(f32);
  };

  let anyAudio = false;
  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (myEpoch !== _epoch || stopped) {
        clearTimeout(timer);
        return false;
      }
      if (done) break;
      clearTimeout(timer); // bytes are flowing — the connect deadline is served
      buffered += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line.startsWith("data:") ? line.slice(5).trim() : line);
        } catch {
          continue; // torn frame — never crash the voice on a parse miss
        }
        if (typeof msg.sample_rate === "number" && !anyAudio) {
          sampleRate = msg.sample_rate;
        }
        if (msg.audio_b64 || (msg.chars && msg.chars.length)) {
          takeChunk(msg);
          if (msg.audio_b64) anyAudio = true;
        }
      }
    }
  } catch {
    clearTimeout(timer);
    if (myEpoch !== _epoch || stopped) return false;
    if (!anyAudio) {
      /* Nothing was ever scheduled — release the handle so the timed path
         runs on a clean slate. */
      if (_activeStream === streamHandle) _activeStream = null;
      try { gain.disconnect(); } catch {}
      return "fallback";
    }
    /* Mid-stream failure with audio already playing: truncate honestly — the
       words spoken were real; never re-speak the line. */
  }
  clearTimeout(timer);
  if (myEpoch !== _epoch || stopped) return false;
  if (!anyAudio) {
    if (_activeStream === streamHandle) _activeStream = null;
    try { gain.disconnect(); } catch {}
    return "fallback";
  }

  /* Wait out the scheduled tail: the last source's natural end, with a
     watchdog for a suspended clock (which never fires `ended`). */
  const remainMs =
    Math.max(0, (nextAt - ctx.currentTime) * 1000) + PLAYBACK_GRACE_MS;
  const natural = await new Promise((resolve) => {
    _activeEnd = resolve;
    const last = sources[sources.length - 1];
    const watchdog = setTimeout(() => {
      if (_activeEnd === resolve) {
        _activeEnd = null;
        resolve(true);
      }
    }, remainMs);
    if (last) {
      last.onended = () => {
        if (_activeEnd === resolve) {
          _activeEnd = null;
          clearTimeout(watchdog);
          resolve(true);
        }
      };
    }
  });

  if (myEpoch === _epoch && _activeStream === streamHandle) {
    if (_activeRaf) {
      cancelAnimationFrame(_activeRaf);
      _activeRaf = null;
    }
    if (onWord) onWord(-1, null);
    _activeStream = null;
    _activeAbort = null;
    try { gain.disconnect(); } catch {}
    if (DEV) console.debug(`[texvoice] ▶■ streamed "${text}" (${natural === true ? "ended" : "cut"})`);
  }
  return natural === true;
}

/* Speak a sealed line word-synced at the LOWEST available latency: the
   streamed-timestamp path first (audio + timing chunk-by-chunk), then the
   full-clip timed path, then the plain stream (voice, no highlight), then
   honest silence — one call, the whole degradation chain. onWord(index)
   drives the glass (-1 clears); onEnd fires only on a natural end. */
export async function texSpeakSynced(text, { onWord, onEnd, prosody } = {}) {
  if (!text) return;
  /* Muted → no claim on the voice (see texSpeak); onEnd still fires at once,
     exactly as the muted degradation chain always resolved, and nothing
     already running is superseded. */
  if (!VOICE_ENABLED) {
    if (onEnd) onEnd();
    return;
  }
  /* Claim a warmed answer BEFORE superseding — _supersede aborts the prefetch
     slot (it must: a stale warm should die with its turn), so a matching,
     already-SETTLED warm is detached here and handed straight to the timed
     path. This is the speculative ask's payoff: the bet resolved while the key
     was still held, prewarmSpeak fetched the full timed clip, and now the
     voice starts from local audio — no TTFB at all, faster than the stream. */
  let warmed = null;
  if (
    _prefetch &&
    _prefetch.ready &&
    _prefetch.text === text &&
    _prefetch.prosody === (prosody || "")
  ) {
    warmed = _prefetch;
    _prefetch = null;
  }
  const myEpoch = _supersede();
  let owned = false;
  if (!warmed && !_streamTimedDead && Date.now() >= _streamTimedRetryAt) {
    const r = await _speakStreamTimedOne(text, myEpoch, { onWord, prosody });
    owned = r !== "fallback";
  }
  if (!owned) {
    if (myEpoch !== _epoch) return;
    await _speakTimedOne(text, myEpoch, { onWord, prosody, warmed });
  }
  if (myEpoch !== _epoch) return;
  if (onEnd) onEnd();
}

/* Play one line through the universal <audio> stream (real voice, no highlight).
   Returns true on a natural end at the current epoch, false otherwise. */
async function _speakStreamOne(text, myEpoch, prosody) {
  /* Voice deactivated — no <audio> stream. Report "did not play"; the line's
     text is already on the glass and clears on its own timer. */
  if (!VOICE_ENABLED) return false;
  if (myEpoch !== _epoch) return false;
  let played = false;
  let watchdog = null;
  try {
    const audio = new Audio();
    audio.src = speakStreamUrl(text, prosody); // proxied GET → streamed audio body
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
export async function texSpeak(text, prosody) {
  if (!text) return;
  /* Muted (voice not provisioned) → a TRUE no-op. Superseding first would let
     an inaudible speak kill a running sequence's epoch — the day-one manifesto
     froze exactly that way. A speak that cannot sound claims nothing. */
  if (!VOICE_ENABLED) return;
  const myEpoch = _supersede();
  await _speakStreamOne(text, myEpoch, prosody);
}

/* Speak a sealed line AND drive an in-sync highlight. onWord(index, word) fires as
   each word begins (-1 clears); onEnd() fires when playback finishes NATURALLY —
   not when a newer utterance supersedes this one, so a stale caller never advances.
   If the word-timed endpoint is unavailable (503 / no ElevenLabs / decode failure)
   this transparently falls back to texSpeak — same voice, no highlight. The text
   passed here is a line Tex already sealed; this never authors or alters it. */
export async function texSpeakTimed(text, { onWord, onEnd, prosody } = {}) {
  if (!text) return;
  /* Muted → no claim on the voice (see texSpeak), but the contract holds:
     onEnd still fires AT ONCE — callers pace their read-linger off it — and
     nothing already running is superseded. */
  if (!VOICE_ENABLED) {
    if (onEnd) onEnd();
    return;
  }
  const myEpoch = _supersede();
  await _speakTimedOne(text, myEpoch, { onWord, prosody });
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
