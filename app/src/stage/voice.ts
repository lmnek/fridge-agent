/**
 * What drives the stage orb. Priority: the courier call audio (F), then the stage session if it's awake (the
 * T fallback), then the C narration of a fallback run (fallbackRun.ts), then Coldex's voice from the kitchen
 * relay (B and C, relay.ts). The orb gets Coldex's level
 * only, never the actor's. If no kitchen audio arrives (relay dead, the video call's audio on instead), it
 * mirrors the kitchen's captions with a synthetic level. Owned by part 1, sub-task 2.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FridgeBrain, Status } from "../realtime";
import type { BusEvent } from "./bus";
import { callLevel } from "./call";
import { fallbackLevel } from "./fallbackRun";
import { relayColdexLevel } from "./relay";

const KITCHEN_WINDOW_MS = 900;
/** Kitchen relay: Coldex counts as speaking above this level, and for HANGOVER_MS after it dips. */
const SPEAKING_LEVEL = 0.03;
const HANGOVER_MS = 350;

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

/**
 * The orb is off (grey ice) through A and B until the actor or Coldex first speaks, and again after a forced
 * A, H or idle, and on a reset (which clears the events). Then it wakes into ice blue.
 */
function awake(events: BusEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "stage" && (e.beat === "A" || e.beat === "H" || e.beat === "idle")) return false;
    if (e.type === "caption" && (e.who === "actor" || e.who === "coldex")) return true;
  }
  return false;
}

/** The kitchen session's own state, as the kitchen page publishes it. */
function kitchenStatus(events: BusEvent[]): Status | null {
  const e = events.findLast((x) => x.type === "status" && x.screen === "kitchen");
  return e ? (e.status as Status) : null;
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

// HACK(demo): a speech-like envelope for the orb while the kitchen talks and no relay audio arrives, only its
// captions: syllable-rate sines plus a little noise stand in for the real output level.
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

  // The kitchen relay: "speaking" follows Coldex's real level. Re-renders only when the state flips.
  const [relay, setRelay] = useState<"none" | "quiet" | "speaking">("none");
  const loudAt = useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      const lv = fallbackLevel() ?? relayColdexLevel();
      if (lv !== null && lv > SPEAKING_LEVEL) loudAt.current = performance.now();
      setRelay(lv === null ? "none" : performance.now() - loudAt.current < HANGOVER_MS ? "speaking" : "quiet");
    }, 50);
    return () => clearInterval(t);
  }, []);

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
    const kitchen = fallbackLevel() ?? relayColdexLevel();
    if (kitchen !== null && !callActive(eventsRef.current)) return { input: 0, output: kitchen };
    const s = kitchenSpeakingSince(eventsRef.current);
    // The kitchen's own status says speaking for as long as its voice plays, longer than the captions stream.
    const speaking =
      callActive(eventsRef.current) ||
      kitchenStatus(eventsRef.current) === "speaking" ||
      (s !== null && Date.now() - s < KITCHEN_WINDOW_MS);
    const target = speaking ? syntheticLevel(performance.now()) : 0.02;
    smooth.current += (target - smooth.current) * 0.25;
    return { input: 0, output: smooth.current };
  }, [brain]);

  if (callLevel() !== null || callActive(events)) return { status: "speaking" as Status, levels };
  if (status !== "off") return { status, levels };
  if (!awake(events)) return { status: "off" as Status, levels };
  // Mirrors the kitchen session: speaking follows the relayed voice (or the captions without it), thinking
  // comes from the kitchen's own status.
  const thinking = kitchenStatus(events) === "thinking";
  const kitchenSpeaking = kitchenStatus(events) === "speaking"; // holds through the pauses between sentences
  if (relay !== "none") {
    return { status: (relay === "speaking" || kitchenSpeaking ? "speaking" : thinking ? "thinking" : "listening") as Status, levels };
  }
  const mirroring = since !== null && Math.max(now, since) - since < KITCHEN_WINDOW_MS;
  const speaking = mirroring || kitchenSpeaking;
  return { status: (speaking ? "speaking" : thinking ? "thinking" : "listening") as Status, levels };
}
