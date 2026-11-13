/**
 * The fridge phone's mic as an input for the stage's Realtime session (the U key, with a VDO.Ninja inset).
 * The inset's VDO.Ninja viewer is a cross-origin iframe, so its audio plays but can't be taken from it. This
 * opens a second, audio-only viewer of the same stream with VDO.Ninja's SDK, which hands over the real track.
 * The SDK loads from unpkg on first use (the stage already needs the internet for VDO.Ninja).
 */
import { phoneRoom } from "./KitchenInset";

const SDK = "https://unpkg.com/@vdoninja/sdk@1.6.2/vdoninja-sdk.js";

let latest: MediaStreamTrack | null = null;
const listeners = new Set<(t: MediaStreamTrack) => void>();
let started = false;

function load(): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("VDO.Ninja SDK failed to load"));
    document.head.append(s);
  });
}

async function start(room: string) {
  await load();
  const vdo = new (window as any).VDONinjaSDK();
  // A new track arrives after every reconnect (the shut fridge drops the phone's Wi-Fi).
  vdo.addEventListener("track", (e: any) => {
    if (e.detail?.track?.kind !== "audio") return;
    latest = e.detail.track as MediaStreamTrack;
    listeners.forEach((l) => l(latest!));
  });
  await vdo.connect();
  await vdo.view(room, { audio: true, video: false });
  if (import.meta.env.DEV) Object.assign(window, { __phone: { vdo, track: () => latest } });
}

/** Calls `cb` with the phone's audio track now (if there is one) and on every new one. Returns unsubscribe. */
export function onPhoneAudio(cb: (t: MediaStreamTrack) => void): () => void {
  const room = phoneRoom();
  if (!room) return () => {};
  if (!started) {
    started = true;
    start(room).catch((e) => {
      started = false;
      console.error("Phone audio:", e);
    });
  }
  listeners.add(cb);
  if (latest && latest.readyState === "live") cb(latest);
  return () => listeners.delete(cb);
}
