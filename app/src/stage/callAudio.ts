/**
 * Plays the courier call (beat F) on the stage speakers: both sides, as the bridge relays them from Twilio
 * and Realtime (bridge/courier.py, mu-law at 8 kHz). Start it from a key or click handler, because browsers
 * only start audio after a gesture. `level()` gives 0..1 for the orb.
 *
 *   const call = playCallAudio();   // on the F hotkey, next to POST /api/courier/call
 *   orb level: call.level()
 *   call.stop();                    // when the `call` event says ended
 */
export interface CallAudio {
  stop(): void;
  level(): number;
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

export function playCallAudio(path = "/api/courier/listen"): CallAudio {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.connect(ctx.destination);
  const playhead: Record<string, number> = {};
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`);

  ws.onmessage = (m) => {
    const { who, audio } = JSON.parse(m.data) as { who: string; audio: string };
    const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
    const buffer = ctx.createBuffer(1, bytes.length, 8000);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < bytes.length; i++) samples[i] = MULAW[bytes[i]];
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    // Each side keeps its own playhead: the courier arrives in real time, Coldex in faster bursts.
    const at = Math.max(ctx.currentTime + 0.08, playhead[who] ?? 0);
    source.start(at);
    playhead[who] = at + buffer.duration;
  };

  const wave = new Uint8Array(analyser.fftSize);
  return {
    stop() {
      ws.close();
      void ctx.close();
    },
    level() {
      analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (const v of wave) sum += ((v - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / wave.length) * 4);
    },
  };
}
