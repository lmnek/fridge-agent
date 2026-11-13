/** Publishes `caption` events to the bus, for the subtitles on stage. Owned by part 1, sub-task 2. */
import { publish } from "./bus";

export type Who = "coldex" | "actor" | "presenter" | "courier";

export function publishCaption(who: Who, id: string, text: string, final: boolean) {
  void publish({ type: "caption", who, id, text, final });
}
