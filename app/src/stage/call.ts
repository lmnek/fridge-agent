/**
 * The courier call (beat F) from the stage's side: the hotkey starts it on the bridge (part 6, bridge/courier.py)
 * and plays both sides of the call on the stage speakers. `callLevel()` drives the orb while it plays.
 */
import type { FridgeBrain } from "../realtime";
import { type CallAudio, playCallAudio } from "./callAudio";
import { setCalling } from "./relay";

let active: CallAudio | null = null;
let muted: FridgeBrain | null = null; // whose mic the call closed, to reopen it when the call ends (as App.tsx does)

function muteFor(brain: FridgeBrain) {
  if (brain.mic) muted = brain;
  brain.setMic(false);
}

/** F hotkey. Must run inside a key or click handler, because browsers only start audio after a gesture. */
export async function startCourierCall(brain: FridgeBrain, fake = false): Promise<void> {
  // A call is already playing (a voice ask started it): K must not dial twice or cut it off.
  if (active) return;
  // The stage session must not hear the call through the speakers and answer it.
  muteFor(brain);
  // HACK(demo): `fake` plays part 6's scripted call through the same `call` and `caption` events.
  // Start the player before the request, while the key press still counts as a gesture.
  // The scripted call has both voices too (bridge/replay/fake_call), so the player runs for it as well.
  active?.stop();
  active = playCallAudio();
  setCalling(true); // one path at a time: the kitchen relay goes quiet for the call
  const res = await fetch(fake ? "/api/courier/fake" : "/api/courier/call", { method: "POST" });
  if (!res.ok) {
    endCallAudio();
    throw new Error(`The courier call failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * A call the stage didn't start (Coldex's call_courier tool, by voice, as on the kitchen page since fb3b60c):
 * play it and close the mic like K does. Never dials, only listens.
 */
export function joinCourierCall(brain: FridgeBrain) {
  if (active) return;
  muteFor(brain);
  active = playCallAudio();
  setCalling(true);
}

export function endCallAudio() {
  active?.stop();
  active = null;
  setCalling(false);
  muted?.setMic(true);
  muted = null;
}

/** 0..1 while the call audio plays, null when there's no call. */
export function callLevel(): number | null {
  return active ? active.level() : null;
}
