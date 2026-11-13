/**
 * The kitchen side of the audio relay (bridge/kitchen_audio.py, beats B and C). The audience hears the kitchen
 * only through the stage app, so the tablet streams two channels to the bridge as 24 kHz PCM16:
 *   "kitchen": the tablet's mic after the browser's echo cancellation (the actor)
 *   "coldex":  Coldex's voice from the session's remote track, before any speaker
 * Coldex still plays on the tablet's own output as before, which goes to the actor's earbud.
 *
 *   const relay = new KitchenRelay();
 *   new FridgeBrain({ ..., stream: (who, s) => relay.attach(who, s) });
 */
const RATE = 24000;
const FRAMES = 1024; // per chunk at the context rate: about 21 ms at 48 kHz
const MAX_BUFFERED = 64 * 1024; // a slow link drops chunks instead of piling up latency

// Collects FRAMES samples off the audio thread and posts them to the page.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${FRAMES}); this.i = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let k = 0; k < ch.length; k++) {
      this.buf[this.i++] = ch[k];
      if (this.i === this.buf.length) { this.port.postMessage(this.buf.slice()); this.i = 0; }
    }
    return true;
  }
}
registerProcessor("coldex-tap", Tap);
`;

type Who = "kitchen" | "coldex";

export class KitchenRelay {
  private ctx: AudioContext | null = null;
  private ready: Promise<void> | null = null;
  private ws: WebSocket | null = null;
  private taps = new Map<Who, () => void>();

  /** Starts (or replaces, after a reconnect) one channel. Call it from the session's `stream` handler. */
  async attach(who: Who, stream: MediaStream) {
    this.connect();
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.ready = this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
    }
    const ctx = this.ctx;
    await this.ready;
    void ctx.resume();
    this.taps.get(who)?.();
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "coldex-tap");
    const down = resampler(ctx.sampleRate / RATE);
    node.port.onmessage = (m) => this.send(who, down(m.data as Float32Array));
    source.connect(node);
    node.connect(ctx.destination); // silent: the tap writes no output, this only keeps it pulled
    this.taps.set(who, () => {
      source.disconnect();
      node.disconnect();
    });
  }

  private connect() {
    if (this.ws) return;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/kitchen/audio`);
    this.ws = ws;
    ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connect(), 1000); // the bridge restarting must not end the relay
    };
  }

  private send(who: Who, pcm: Int16Array) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) return;
    const bytes = new Uint8Array(pcm.buffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    ws.send(JSON.stringify({ who, audio: btoa(bin), t: Date.now() }));
  }
}

/** Streaming linear resampler, float in, PCM16 out. `ratio` is input rate over output rate. */
function resampler(ratio: number) {
  let pos = 0; // where the next output sample falls, in input samples from this chunk's start (-1 = last one)
  let last = 0;
  return (input: Float32Array): Int16Array => {
    const n = input.length;
    const out = new Int16Array(Math.max(0, Math.ceil((n - 1 - pos) / ratio)));
    let k = 0;
    let p = pos;
    while (p < n - 1 && k < out.length) {
      const i = Math.floor(p);
      const a = i < 0 ? last : input[i];
      const v = a + (input[i + 1] - a) * (p - i);
      out[k++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
      p += ratio;
    }
    pos = Math.max(-1, p - n);
    last = input[n - 1];
    return k === out.length ? out : out.slice(0, k);
  };
}
