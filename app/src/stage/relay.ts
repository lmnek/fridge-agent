/**
 * The kitchen relay on the stage (beats B and C): the actor and Coldex from the tablet, played on the stage
 * speakers (bridge/kitchen_audio.py, app/src/kitchenAudio.ts). The audience hears the kitchen only through
 * this, never through the video call. Starts on the first click or key on the stage, because browsers only
 * start audio after a gesture.
 *
 * One path at a time: it's silent while the courier call plays, and while the video call's own audio is on
 * (the U key, the fallback when the relay dies), so Coldex is never heard twice.
 */
import { type CallAudio, playCallAudio } from "./callAudio";

let relay: CallAudio | null = null;
let videoAudio = false;
let calling = false;

const apply = () => relay?.mute(videoAudio || calling);

/** Call from a click or key handler. Safe to call again. */
export function startRelay() {
  if (relay) return;
  relay = playCallAudio("/api/kitchen/listen", { format: "pcm24k", maxLag: 0.35, reconnect: true });
  apply();
  if (import.meta.env.DEV) Object.assign(window, { __relay: relay });
}

/** Coldex's level from the kitchen, 0..1, or null while no kitchen audio arrives (relay off or dead). */
export function relayColdexLevel(): number | null {
  if (!relay || performance.now() - relay.lastAt() > 1000) return null;
  return relay.level("coldex");
}

/** The fallback when the relay dies: the video call's audio instead of the relay's. */
export function setVideoAudio(on: boolean) {
  videoAudio = on;
  apply();
}

/** The courier call has the speakers (beat F). */
export function setCalling(on: boolean) {
  calling = on;
  apply();
}
