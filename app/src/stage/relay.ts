/**
 * The kitchen relay on the stage (beats B and C): the actor and Coldex from the tablet, played on the stage
 * speakers (bridge/kitchen_audio.py, app/src/kitchenAudio.ts). The audience hears the kitchen only through
 * this, never through the video call. Starts on the first click or key on the stage, because browsers only
 * start audio after a gesture.
 *
 * One path at a time: it's silent while the courier call plays. And while the inset's own audio is on (the
 * U key: the Reolink camera's mic or the fridge phone's), the relay's `kitchen` channel is muted, so the actor
 * is never heard twice. Coldex always comes through the relay.
 */
import { type CallAudio, playCallAudio } from "./callAudio";

let relay: CallAudio | null = null;
let videoAudio = false;
let calling = false;
let fallback = false;

const apply = () => {
  relay?.mute(calling || fallback);
  relay?.mute(videoAudio, "kitchen");
};

/** Call from a click or key handler. Safe to call again. */
export function startRelay() {
  if (relay) return;
  relay = playCallAudio("/api/kitchen/listen", { format: "pcm24k", maxLag: 0.35, reconnect: true });
  apply();
  if (import.meta.env.DEV) Object.assign(window, { __relay: relay });
}

/** Coldex's level from the kitchen, 0..1, or null while no kitchen audio arrives (relay off or dead). */
export function relayColdexLevel(): number | null {
  if (!relay || fallback || performance.now() - relay.lastAt() > 1000) return null;
  return relay.level("coldex");
}

/** The inset's own mic (camera or phone) instead of the relay's kitchen mic. Coldex stays on the relay. */
export function setVideoAudio(on: boolean) {
  videoAudio = on;
  apply();
}

/** The courier call has the speakers (beat F). */
export function setCalling(on: boolean) {
  calling = on;
  apply();
}

/** A fallback run plays on the stage (Z or X): the kitchen goes quiet and stops driving the orb. */
export function setFallback(on: boolean) {
  fallback = on;
  apply();
}
