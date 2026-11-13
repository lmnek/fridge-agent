/**
 * The courier call (beat F) from the stage's side: the hotkey starts it on the bridge (part 6, bridge/courier.py)
 * and plays both sides of the call on the stage speakers. `callLevel()` drives the orb while it plays.
 */
import type { FridgeBrain } from "../realtime";

interface CallAudio {
  stop(): void;
  level(): number;
}

let active: CallAudio | null = null;

/** F hotkey. Must run inside a key or click handler, because browsers only start audio after a gesture. */
export async function startCourierCall(brain: FridgeBrain, fake = false): Promise<void> {
  // The stage session must not hear the call through the speakers and answer it.
  brain.setMic(false);
  // HACK(demo): `fake` plays part 6's scripted call through the same `call` and `caption` events.
  const res = await fetch(fake ? "/api/courier/fake" : "/api/courier/call", { method: "POST" });
  if (!res.ok) throw new Error(`The courier call failed: ${res.status} ${await res.text()}`);
  if (!fake) {
    active?.stop();
    active = null; // playback hooks in here once part 6's callAudio.ts is merged
  }
}

export function endCallAudio() {
  active?.stop();
  active = null;
}

/** 0..1 while the call audio plays, null when there's no call. */
export function callLevel(): number | null {
  return active ? active.level() : null;
}
