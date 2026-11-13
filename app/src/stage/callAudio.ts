/**
 * Plays a relayed audio stream on the stage speakers. Two of them, same `{who, audio}` messages:
 * - the courier call (beat F): both sides as the bridge relays them from Twilio and Realtime
 *   (bridge/courier.py, mu-law at 8 kHz). The default.
 * - the kitchen relay (beats B and C): the actor and Coldex from the tablet (bridge/kitchen_audio.py,
 *   PCM16 at 24 kHz), with `{ format: "pcm24k" }`.
 * Start it from a key or click handler, because browsers only start audio after a gesture. `level()` gives
 * 0..1 for the orb, `level("coldex")` one side only.
 *
 *   const call = playCallAudio();   // on the F hotkey, next to POST /api/courier/call
 *   orb level: call.level()
 *   call.stop();                    // when the `call` event says ended
 */
export interface CallAudio {
  stop(): void;
  level(who?: string): number;
  /** Silences the speakers, or one side only (`who`). The levels keep working. */
  mute(on: boolean, who?: string): void;
  /** When the last chunk arrived (performance.now()), 0 if none yet. */
  lastAt(): number;
  /** Latency so far, ms: transit (kitchen to stage, needs the sender's `t`) and the playback queue, p50 and p95. */
  stats(): { chunks: number; transit: [number, number]; queue: [number, number]; chunkMs: number; outputMs: number };
}

export type Format = "mulaw8k" | "pcm24k";

export interface Options {
  format?: Format;
  /**
   * Cap on how far a side may queue ahead, in seconds. The kitchen streams in real time, so a late burst would
   * otherwise add its delay for good. Leave it off for the call: Coldex arrives in faster bursts there.
   */
  maxLag?: number;
  /** Reopen the socket when it drops (the kitchen relay runs for minutes). */
  reconnect?: boolean;
}

// G.711 mu-law to float, one entry per byte.
const MULAW = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const magnitude = ((((u & 0x0f) << 3) + 0x84) << ((u >> 4) & 0x07)) - 0x84;
    table[i] = (u & 0x80 ? -magnitude : magnitude) / 32768;
  }
  return table;
})();

const LEAD = 0.08; // seconds of jitter buffer before a side starts

function decode(ctx: AudioContext, bytes: Uint8Array, format: Format): AudioBuffer {
  if (format === "mulaw8k") {
    const buffer = ctx.createBuffer(1, bytes.length, 8000);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < bytes.length; i++) samples[i] = MULAW[bytes[i]];
    return buffer;
  }
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length >> 1);
  const buffer = ctx.createBuffer(1, Math.max(1, pcm.length), 24000);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
  return buffer;
}

function rms(analyser: AnalyserNode | undefined, wave: Uint8Array<ArrayBuffer>) {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(wave);
  let sum = 0;
  for (const v of wave) sum += ((v - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / wave.length) * 4);
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
};

export function playCallAudio(path = "/api/courier/listen", { format = "mulaw8k", maxLag, reconnect }: Options = {}): CallAudio {
  const ctx = new AudioContext();
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const all = ctx.createAnalyser();
  all.fftSize = 512;
  all.connect(out);
  const sides: Record<string, AnalyserNode> = {};
  const gains: Record<string, GainNode> = {};
  const mutedSides = new Set<string>();
  const playhead: Record<string, number> = {};
  const transit: number[] = [];
  const queue: number[] = [];
  let chunks = 0;
  let chunkMs = 0;
  let last = 0;
  let ws: WebSocket | null = null;
  let stopped = false;

  const side = (who: string) => {
    if (!sides[who]) {
      sides[who] = ctx.createAnalyser();
      sides[who].fftSize = 512;
      gains[who] = ctx.createGain();
      gains[who].gain.value = mutedSides.has(who) ? 0 : 1;
      sides[who].connect(gains[who]).connect(all);
    }
    return sides[who];
  };

  const onMessage = (m: MessageEvent) => {
    const { who, audio, t } = JSON.parse(m.data) as { who: string; audio: string; t?: number };
    const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
    const source = ctx.createBufferSource();
    source.buffer = decode(ctx, bytes, format);
    source.connect(side(who));
    // Each side keeps its own playhead: the courier arrives in real time, Coldex in faster bursts.
    let at = Math.max(ctx.currentTime + LEAD, playhead[who] ?? 0);
    if (maxLag && at - ctx.currentTime > maxLag) at = ctx.currentTime + LEAD;
    source.start(at);
    playhead[who] = at + source.buffer.duration;
    last = performance.now();
    chunks++;
    chunkMs = source.buffer.duration * 1000;
    if (typeof t === "number") transit.push(Date.now() - t);
    queue.push((at - ctx.currentTime) * 1000);
    if (transit.length > 400) transit.shift();
    if (queue.length > 400) queue.shift();
  };

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`);
    ws.onmessage = onMessage;
    ws.onclose = () => {
      if (!stopped && reconnect) setTimeout(connect, 1000);
    };
  };
  connect();

  const wave = new Uint8Array(512);
  return {
    stop() {
      stopped = true;
      ws?.close();
      void ctx.close();
    },
    level(who?: string) {
      return rms(who ? sides[who] : all, wave);
    },
    mute(on: boolean, who?: string) {
      if (who) {
        if (on) mutedSides.add(who);
        else mutedSides.delete(who);
        if (gains[who]) gains[who].gain.value = on ? 0 : 1;
        return;
      }
      out.gain.value = on ? 0 : 1;
    },
    lastAt: () => last,
    stats: () => ({
      chunks,
      transit: [pct(transit, 0.5), pct(transit, 0.95)],
      queue: [pct(queue, 0.5), pct(queue, 0.95)],
      chunkMs: Math.round(chunkMs),
      outputMs: Math.round(((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? ctx.baseLatency ?? 0) * 1000),
    }),
  };
}
