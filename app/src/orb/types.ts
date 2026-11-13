import type { Status } from "../realtime";

export type Levels = () => { input: number; output: number };

/**
 * What every orb variant gets. The variant renders one element that fills its parent (a square
 * button owned by Orb.tsx, which also handles the click and the aria label).
 * `levels()` is 0..1, raw and jittery (RMS of the last ~10 ms of audio, times 4), so read it every
 * frame and smooth it yourself. `input` is the mic (listening), `output` is Coldex's voice (speaking).
 * Status: "off" = idle and floating, "connecting" = waking up, then listening, thinking, speaking.
 */
export type OrbVariantProps = { status: Status; levels: Levels };
