/**
 * What drives the stage orb. Priority: the courier call audio (F), then the stage session once it's awake
 * (from C on), and while it's off (A and B) a mirror of the kitchen tablet, so Coldex speaking there makes
 * the stage orb speak too. Owned by part 1, sub-task 2.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FridgeBrain, Status } from "../realtime";
import type { BusEvent } from "./bus";
import { callLevel } from "./call";

const KITCHEN_WINDOW_MS = 900;

/** When the newest kitchen Coldex caption arrived, if that response is still streaming (not final). */
function kitchenSpeakingSince(events: BusEvent[]): number | null {
  const finals = new Set<string>();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "caption" || e.who !== "coldex") continue;
    const id = String(e.id ?? "");
    if (id.startsWith("stage-")) continue;
    if (e.final) {
      finals.add(id);
      continue;
    }
    if (finals.has(id)) continue;
    return Number(e.ts ?? 0);
  }
  return null;
}

/** A `call` event in phase answered with no later ended. */
function callActive(events: BusEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "call") continue;
    if (e.phase === "ended") return false;
    if (e.phase === "answered") return true;
  }
  return false;
}

// HACK(demo): a speech-like envelope for the orb while the kitchen talks. The stage doesn't get the kitchen
// audio, only its captions, so syllable-rate sines plus a little noise stand in for the real output level.
function syntheticLevel(t: number) {
  const s = t / 1000;
  const syll = 0.5 + 0.5 * Math.sin(s * 2 * Math.PI * 4.3);
  const word = 0.5 + 0.5 * Math.sin(s * 2 * Math.PI * 1.7 + 1.3);
  const phrase = 0.5 + 0.5 * Math.sin(s * 2 * Math.PI * 0.45 + 0.4);
  const v = 0.25 + 0.55 * (0.5 * syll * word + 0.3 * phrase + 0.2 * Math.random());
  return Math.min(0.8, Math.max(0.25, v));
}

export function useOrbVoice(brain: FridgeBrain, status: Status, events: BusEvent[]) {
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const statusRef = useRef(status);
  statusRef.current = status;
  const smooth = useRef(0);

  const since = status === "off" ? kitchenSpeakingSince(events) : null;
  const [now, setNow] = useState(() => Date.now());

  // Re-render when the window runs out, so the orb drops back to listening once the kitchen goes quiet.
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const left = since + KITCHEN_WINDOW_MS - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), left + 20);
    return () => clearTimeout(t);
  }, [since]);

  const levels = useCallback(() => {
    const call = callLevel();
    if (call !== null) return { input: call, output: call };
    if (statusRef.current !== "off" && !callActive(eventsRef.current)) return brain.levels();
    const s = kitchenSpeakingSince(eventsRef.current);
    const speaking = callActive(eventsRef.current) || (s !== null && Date.now() - s < KITCHEN_WINDOW_MS);
    const target = speaking ? syntheticLevel(performance.now()) : 0.02;
    smooth.current += (target - smooth.current) * 0.25;
    return { input: 0, output: smooth.current };
  }, [brain]);

  if (callLevel() !== null || callActive(events)) return { status: "speaking" as Status, levels };
  if (status !== "off") return { status, levels };
  const mirroring = since !== null && Math.max(now, since) - since < KITCHEN_WINDOW_MS;
  return { status: (mirroring ? "speaking" : "listening") as Status, levels };
}
