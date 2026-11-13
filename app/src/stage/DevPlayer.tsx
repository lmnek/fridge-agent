/**
 * The dev event player: replays a recorded A–H run into the bus with feed(). Owned by part 1, sub-task 3.
 * Shown only with ?dev in the URL. ?dev=play autoplays, &speed=4 plays four times faster.
 * Keys: P play/pause, N next event, [ ] previous/next beat, Shift R back to 0 (with the stage reset).
 */
import { useEffect, useRef, useState } from "react";
import { type BusEvent, feed, resetBus } from "./bus";
import { BEATS, type Step, demoRun as localRun } from "./devRun";
import { typing } from "./Hotkeys";
import "./hotkeys.css";

// Part 2's fixtures win as soon as app/src/stage/cards/fixtures.ts exists (empty glob until then).
const part2 = Object.values(import.meta.glob<{ demoRun?: Step[] }>("./cards/fixtures.ts", { eager: true }))[0];
const RUN: Step[] = [...(part2?.demoRun?.length ? part2.demoRun : localRun)].sort((a, b) => a.at - b.at);
const END = Math.max(RUN.at(-1)?.at ?? 0, 180_000);

const params = new URLSearchParams(location.search);
const DEV = params.has("dev");
const SPEED = Number(params.get("speed")) || 1;

const beatAt = (t: number) => BEATS.findLast((b) => b.at <= t)?.beat ?? "A";
const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function DevPlayer() {
  return DEV ? <Player /> : null;
}

function Player() {
  const [playing, setPlaying] = useState(params.get("dev") === "play");
  const [time, setTime] = useState(0);
  const t = useRef(0); // run time, ms
  const next = useRef(0); // index of the next step to feed

  const send = (ev: BusEvent) => feed({ ...ev });

  /** Feeds every step up to run time `to`. Going backwards replays from 0. */
  const seek = (to: number) => {
    if (to < t.current) {
      resetBus();
      next.current = 0;
    }
    t.current = Math.max(0, Math.min(to, END));
    while (next.current < RUN.length && RUN[next.current].at <= t.current) send(RUN[next.current++].event);
    setTime(t.current);
  };

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      seek(t.current + (now - last) * SPEED);
      last = now;
      if (t.current >= END) setPlaying(false);
    }, 50);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey && k === "r") {
        resetBus();
        next.current = 0;
        t.current = 0;
        setTime(0);
        return;
      }
      if (e.shiftKey) return;
      if (k === "p") setPlaying((p) => !p);
      else if (k === "n" && next.current < RUN.length) seek(RUN[next.current].at);
      else if (k === "]") seek(BEATS.find((b) => b.at > t.current)?.at ?? END);
      else if (k === "[") {
        // Back to the start of this beat, or the one before if we're right at its start.
        const cur = BEATS.findLast((b) => b.at <= t.current - 1500);
        seek(cur?.at ?? 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="hk-dev" data-dev-beat={beatAt(time)} data-dev-playing={playing ? "1" : "0"}>
      <span className="hk-dev-time">{mmss(time)}</span>
      <span className="hk-dev-beat">{beatAt(time)}</span>
      <span>{playing ? "playing" : "paused"}</span>
      <span className="hk-dev-src">
        {part2?.demoRun?.length ? "fixtures" : "devRun"}
        {SPEED !== 1 ? ` · ${SPEED}x` : ""} · {next.current}/{RUN.length}
      </span>
    </div>
  );
}
