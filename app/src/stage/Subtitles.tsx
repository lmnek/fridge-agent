/**
 * Live subtitles under the orb, for everyone who speaks (`caption` events). Owned by part 1, sub-task 2.
 *
 * Captions are grouped by `id` (one utterance each, later events replace the text). The newest utterance is
 * large, the one before it small and dimmed above it, each with a quiet speaker label above its text, so the
 * text gets the column's full width.
 * The newest wraps to up to 3 lines (the oldest lines clip off the top). Everything fades over 400 ms once
 * max(4 s, chars / 15 per s) has passed after the last final with no newer speech.
 */
import { useEffect, useState } from "react";
import type { BusEvent } from "./bus";
import "./subtitles.css";

/** A caption stays at least this long after its final, or text length at this reading speed, whichever is longer. */
const MIN_HOLD_MS = 4000;
const CHARS_PER_S = 15;
const holdMs = (text: string) => Math.max(MIN_HOLD_MS, (text.length / CHARS_PER_S) * 1000);

const LABELS: Record<string, string> = {
  coldex: "Coldex",
  actor: "Kitchen",
  presenter: "Presenter",
  courier: "Courier",
};

type Utterance = { id: string; who: string; text: string; final: boolean; ts: number };

function utterances(events: BusEvent[]): Utterance[] {
  const byId = new Map<string, Utterance>();
  for (const e of events) {
    if (e.type !== "caption") continue;
    const id = String(e.id ?? "");
    const prev = byId.get(id);
    // A partial that lands after its final (requests can race) must not reopen it.
    if (prev?.final && !e.final) continue;
    const u = { id, who: String(e.who ?? "coldex"), text: String(e.text ?? ""), final: Boolean(e.final), ts: Number(e.ts ?? 0) };
    if (prev) Object.assign(prev, u);
    else byId.set(id, u);
  }
  return [...byId.values()].filter((u) => u.text.trim());
}

export function Subtitles({ events }: { events: BusEvent[] }) {
  const all = utterances(events);
  const shown = all.slice(-3);
  const newest = shown.at(-1);
  const lastTs = all.reduce((m, u) => Math.max(m, u.ts), 0);
  const settled = all.length > 0 && all.every((u) => u.final);

  const [, tick] = useState(0);
  const fadeAt = settled ? lastTs + holdMs(newest?.text ?? "") : 0;
  useEffect(() => {
    if (!fadeAt) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, fadeAt - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [fadeAt]);
  const faded = settled && Date.now() >= fadeAt;

  return (
    <div className="subtitles" data-faded={faded || !newest} aria-live="polite">
      {shown.map((u, i) => {
        const role = i === shown.length - 1 ? "now" : i === shown.length - 2 ? "prev" : "gone";
        return (
          <div key={u.id} className="subtitle" data-role={role} data-who={u.who}>
            <span className="subtitle-who">{LABELS[u.who] ?? u.who}</span>
            <p className="subtitle-text">{u.text.trim()}</p>
          </div>
        );
      })}
    </div>
  );
}
