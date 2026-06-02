/* tex-mic-worklet.js — the microphone, only while held.
 *
 * An AudioWorkletProcessor (the current standard; ScriptProcessorNode
 * was deprecated years ago and runs on the main thread). This runs on
 * the audio render thread: it takes the mic's float samples at the
 * context rate, linearly resamples to 16 kHz, converts to 16-bit PCM,
 * and posts raw frames to the main thread, which streams them to Tex's
 * own self-hosted speech gateway over a WebSocket.
 *
 * The processor only exists for the lifetime of the held gesture. When
 * the node is disconnected on release, capture stops. There is no path
 * by which this keeps running with the mic open — that is the hot-mic
 * contradiction the product refuses, enforced in code, not just policy.
 */

const TARGET_RATE = 16000;

class TexMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._carry = 0; // fractional read position carried across blocks
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    const ratio = sampleRate / TARGET_RATE; // sampleRate is a worklet global
    const outLen = Math.floor((channel.length - this._carry) / ratio);
    if (outLen <= 0) return true;

    const out = new Int16Array(outLen);
    let pos = this._carry;
    for (let i = 0; i < outLen; i++) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = channel[idx] || 0;
      const b = channel[idx + 1] !== undefined ? channel[idx + 1] : a;
      let s = a + (b - a) * frac; // linear interpolation
      s = Math.max(-1, Math.min(1, s));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      pos += ratio;
    }
    this._carry = pos - channel.length;

    this.port.postMessage(out.buffer, [out.buffer]);
    return true;
  }
}

registerProcessor("tex-mic", TexMicProcessor);
