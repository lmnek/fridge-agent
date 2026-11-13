/**
 * The stage's view of the bridge event bus (docs/handoffs/README.md, "Stage contract").
 *
 * One SSE connection per page. `useBus()` returns every event since the stage was last reset, in arrival
 * order: the bridge stream plus anything the dev player feeds in with `feed()`. A `stage` event with
 * `action: "reset"` (from any screen) clears the list, and so does `resetBus()` locally.
 */
import { useSyncExternalStore } from "react";

export type BusEvent = { type: string; [k: string]: any };

let events: BusEvent[] = [];
const listeners = new Set<() => void>();
let source: EventSource | null = null;
let paused = false;

/** HACK(demo): while a fallback run plays (fallbackRun.ts), live events are dropped, except the hotkeys' stage events. */
export function pauseLive(on: boolean) {
  paused = on;
}

function emit() {
  for (const l of listeners) l();
}

/** Adds an event to the local list only (dev player, tests). Every event gets `ts` (ms) if it has none. */
export function feed(ev: BusEvent) {
  if (ev.type === "stage" && ev.action === "reset") {
    events = [];
  } else {
    events = [...events, ev.ts ? ev : { ...ev, ts: Date.now() }];
  }
  emit();
}

/** Clears the local list. Use `publish({ type: "stage", action: "reset" })` to clear every screen. */
export function resetBus() {
  events = [];
  emit();
}

/** Puts an event on the bridge bus, so every screen (and this one, via SSE) sees it. */
export async function publish(ev: BusEvent): Promise<void> {
  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ev),
    });
  } catch {
    // HACK(demo): no bridge running (dev player only). Feed it locally so the stage still reacts.
    feed(ev);
  }
}

function connect() {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
  source.onmessage = (m) => {
    try {
      const ev = JSON.parse(m.data);
      if (!paused || ev.type === "stage") feed(ev);
    } catch {
      // not JSON, ignore
    }
  };
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  connect();
  return () => {
    listeners.delete(cb);
  };
}

const snapshot = () => events;

export function useBus(): BusEvent[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The current list outside React (hotkeys, the dev player). */
export function busEvents(): BusEvent[] {
  return events;
}
