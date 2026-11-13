/**
 * What drives the stage orb. The stage session's own status and levels once it's awake (from C on).
 * Owned by part 1, sub-task 2, which can mirror the kitchen's Coldex speech here while the stage session is off.
 */
import { useCallback } from "react";
import type { FridgeBrain, Status } from "../realtime";
import type { BusEvent } from "./bus";

export function useOrbVoice(brain: FridgeBrain, status: Status, _events: BusEvent[]) {
  const levels = useCallback(() => brain.levels(), [brain]);
  return { status, levels };
}
