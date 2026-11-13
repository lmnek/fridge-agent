import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { BusEvent } from "../bus";
import { CardFrame, latest } from "./ui";
import "./CallCard.css";

const PHASE_LABEL: Record<string, string> = {
  // HACK(demo): Coldex really dials out, but the story is the courier calling in and Coldex picking up.
  dialing: "Incoming call",
  ringing: "Incoming call",
  answered: "Connected",
  ended: "Call ended",
};
const SHOWN = 6; // subtitle lines kept on screen (the oldest clip under the top fade)

type Line = { id: string; who: string; text: string; final: boolean };

function mmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function CallCard({ events }: { events: BusEvent[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const call = latest(events, "call");
  const dialing = latest(events, "call", (e) => e.phase === "dialing");
  const answered = latest(events, "call", (e) => e.phase === "answered" && (!dialing || e.ts >= dialing.ts));
  const ended = latest(events, "call", (e) => e.phase === "ended" && (!dialing || e.ts >= dialing.ts));
  const phase = call ? String(call.phase) : "dialing";
  const failed = Boolean(call?.error) || (phase === "ended" && call?.status === "failed");

  // Subtitles: newest text per caption id, only this call, only the two voices on the line.
  const byId = new Map<string, Line>();
  for (const e of events) {
    if (e.type !== "caption" || (e.who !== "coldex" && e.who !== "courier")) continue;
    if (dialing && e.ts < dialing.ts) continue;
    byId.set(String(e.id), { id: String(e.id), who: String(e.who), text: String(e.text), final: Boolean(e.final) });
  }
  const lines = [...byId.values()].slice(-SHOWN);

  const clock = answered ? mmss((ended ? ended.ts : Math.max(now, answered.ts)) - answered.ts) : "00:00";
  const reaching = phase === "dialing" || phase === "ringing"; // the line is open but nobody has picked up
  const live = reaching || phase === "answered";
  const state = failed ? "failed" : phase;
  const label = failed ? "Call failed" : (PHASE_LABEL[phase] ?? phase);
  const number = call?.number ? String(call.number) : "";

  return (
    <CardFrame
      icon="F"
      kicker="Incoming call"
      title="Rohlík courier"
      live={live}
      aside={<span className={`ck-call-time${answered && !ended ? " is-running" : ""}`}>{clock}</span>}
    >
      {/* The line itself: what the call is doing, and who is on the other end. */}
      <div className={`ck-call-status is-${state}`}>
        <span className="ck-call-signal" aria-hidden>
          <i />
        </span>
        <span className="ck-call-phase">{label}</span>
        {number && <span className="ck-call-number">{number}</span>}
      </div>

      {failed && <p className="ck-call-error">{String(call?.error ?? "The call could not be completed.")}</p>}

      {lines.length === 0 ? (
        <div className={`ck-call-wait is-${state}`}>
          {reaching && (
            <span className="ck-call-rings" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          )}
          <p>
            {phase === "ended"
              ? "No conversation was captured."
              : phase === "answered"
                ? "Listening…"
                : phase === "ringing"
                  ? "Coldex is picking up…"
                  : "The Rohlík courier is calling…"}
          </p>
        </div>
      ) : (
        <div className="ck-call-feed">
          <AnimatePresence initial={false}>
            {lines.map((l, i) => {
              const age = lines.length - 1 - i;
              const opacity = phase === "ended" ? (age === 0 ? 1 : 0.8) : [1, 0.8, 0.62, 0.48][age] ?? 0.4;
              return (
                <motion.div
                  key={l.id}
                  layout="position"
                  className={`ck-call-line ${l.who}${age === 0 ? " is-new" : ""}`}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 32 }}
                >
                  <span className="ck-call-speaker">{l.who === "coldex" ? "Coldex" : "Courier"}</span>
                  <p className="ck-call-text">
                    {l.text}
                    {!l.final && <span className="ck-call-caret" />}
                  </p>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </CardFrame>
  );
}
