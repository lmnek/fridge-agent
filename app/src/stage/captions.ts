/** Publishes `caption` events to the bus, for the subtitles on stage. Owned by part 1, sub-task 2. */
import { publish } from "./bus";

export type Who = "coldex" | "actor" | "presenter" | "courier";

const THROTTLE_MS = 120;
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; next: { who: Who; text: string } | null }>();

function send(who: Who, id: string, text: string, final: boolean) {
  void publish({ type: "caption", who, id, text, final });
}

/**
 * Partials are throttled per id (leading send, then at most one per 120 ms with a trailing flush).
 * A final goes out at once and drops any pending partial for that id.
 */
export function publishCaption(who: Who, id: string, text: string, final: boolean) {
  const slot = pending.get(id);
  if (final) {
    if (slot) clearTimeout(slot.timer);
    pending.delete(id);
    send(who, id, text, true);
    return;
  }
  if (slot) {
    slot.next = { who, text };
    return;
  }
  send(who, id, text, false);
  const tick = () => {
    const s = pending.get(id);
    if (!s) return;
    if (!s.next) {
      pending.delete(id);
      return;
    }
    send(s.next.who, id, s.next.text, false);
    s.next = null;
    s.timer = setTimeout(tick, THROTTLE_MS);
  };
  pending.set(id, { timer: setTimeout(tick, THROTTLE_MS), next: null });
}
