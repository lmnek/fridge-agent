/**
 * HACK(demo): the B and C fallbacks, with no recordings (Z and X on the stage). Plays part 2's fixture run live
 * on the stage from beat B or beat C to the end of C, as if the bus delivered it, while the live bus and the
 * kitchen relay stay quiet. For C, part 3's rendered narration (app/public/demo/c-narration.wav, try_voices.py
 * --narration) plays in sync if it exists: Coldex's C captions are stretched to its length, and the orb follows
 * it. Without it the run is silent and the subtitles carry it. Only this screen sees the run (feed, not publish),
 * so nothing reaches the bridge, Telegram or Rohlík.
 */
import { feed, pauseLive, resetBus } from "./bus";
import { demoRun } from "./cards/fixtures";
import { setFallback } from "./relay";

type Step = { at: number; event: { type: string; [k: string]: any } };

const BEAT_AT = { B: 10_000, C: 40_000 } as const;
const END = 80_000; // D/E starts here: the presenter takes over again
const NARRATION = "/demo/c-narration.wav";

let running: { stop(): void } | null = null;
let narrationLevel: (() => number) | null = null;

export const fallbackPlaying = () => running !== null;
if (import.meta.env.DEV) Object.assign(window, { __fallback: { level: () => fallbackLevel(), playing: fallbackPlaying } });

/** 0..1 while the C narration plays, null otherwise. */
export function fallbackLevel(): number | null {
  return narrationLevel ? narrationLevel() : null;
}

export function stopFallback() {
  running?.stop();
}

/** Call from the Z or X key handler (the narration needs the gesture). Pressing again stops it. */
export async function playFallback(from: "B" | "C"): Promise<void> {
  if (running) return stopFallback();
  const start = BEAT_AT[from];
  const ctx = new AudioContext();
  const wav = await loadNarration(ctx);

  // Coldex's C lines in the fixtures, stretched onto the narration's length when there is one.
  const coldex = demoRun.filter((s) => s.at >= BEAT_AT.C && s.at < END && s.event.type === "caption" && s.event.who === "coldex");
  const first = coldex[0]?.at ?? BEAT_AT.C;
  const last = coldex.at(-1)?.at ?? first;
  const k = wav && last > first ? (wav.duration * 1000) / (last - first) : 1;
  const warp = (t: number) => (t <= first ? t : t <= last ? first + (t - first) * k : t + (last - first) * (k - 1));
  const steps: Step[] = demoRun.filter((s) => s.at < END).map((s) => ({ at: warp(s.at), event: s.event }));
  const end = warp(END);

  // Everything up to the start lands at once (state only, no old captions), then the rest plays in real time.
  pauseLive(true);
  setFallback(true);
  resetBus();
  let next = 0;
  while (next < steps.length && steps[next].at <= start) {
    if (steps[next].event.type !== "caption") feed({ ...steps[next].event });
    next++;
  }

  let source: AudioBufferSourceNode | null = null;
  if (wav) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(ctx.destination);
    source = ctx.createBufferSource();
    source.buffer = wav;
    source.connect(analyser);
    const wave = new Uint8Array(512);
    narrationLevel = () => {
      analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (const v of wave) sum += ((v - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / wave.length) * 4);
    };
  }

  let narrating = false;
  const t0 = performance.now() - start;
  const timer = setInterval(() => {
    const now = performance.now() - t0;
    while (next < steps.length && steps[next].at <= now) feed({ ...steps[next++].event });
    // Started on the run's clock, not the audio clock: an audio device that's slow to wake must not shift it.
    if (source && !narrating && now >= first) {
      source.start();
      narrating = true;
    }
    if (now >= end) running?.stop();
  }, 40);

  running = {
    stop() {
      clearInterval(timer);
      if (narrating) source?.stop();
      void ctx.close();
      narrationLevel = null;
      running = null;
      pauseLive(false);
      setFallback(false);
    },
  };
}

/** Part 3's C narration, decoded, or null if it isn't there (the dev server answers unknown paths with HTML). */
async function loadNarration(ctx: AudioContext): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(NARRATION);
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio")) return null;
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  }
}
