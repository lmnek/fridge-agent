import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { BusEvent } from "../bus";
import { CardFrame, Tag, latest } from "./ui";
import "./CallCard.css";

const PHASE_LABEL: Record<string, string> = {
  dialing: "Dialing",
  ringing: "Ringing",
  answered: "Connected",
  ended: "Call ended",
};
const SHOWN = 4; // subtitle lines kept on screen

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
  const phase = call ? String(call.phase) : "";
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
  const live = phase === "dialing" || phase === "ringing" || phase === "answered";
  const label = !call ? "Calling the courier" : PHASE_LABEL[phase] ?? phase;

  return (
    <CardFrame
      kicker="Phone call"
      title="Rohlík courier"
      live={live || !call}
      aside={<span className={`ck-call-time${phase === "ended" ? " is-ended" : ""}`}>{clock}</span>}
    >
      <div className="ck-call-meta">
        <Tag tone={failed ? "gone" : phase === "ended" ? undefined : phase === "answered" ? "ok" : "lamp"}>
          {label}
          {!call || phase === "dialing" || phase === "ringing" ? "…" : ""}
        </Tag>
        <span>Coldex {phase === "ended" ? "called" : "is calling"}{call?.number ? ` ${call.number}` : ""}</span>
      </div>

      {failed && <p className="ck-call-error">{String(call?.error ?? "The call could not be completed.")}</p>}

      <div className="ck-call-feed">
        {lines.length === 0 && (
          <p className="ck-call-wait">
            {!call ? "Calling the courier…" : phase === "ended" ? "No conversation was captured." : phase === "answered" ? "Listening…" : "Waiting for an answer…"}
          </p>
        )}
        <AnimatePresence initial={false}>
          {lines.map((l, i) => {
            const age = lines.length - 1 - i;
            return (
              <motion.div
                key={l.id}
                layout="position"
                className={`ck-call-line ${l.who}${age === 0 ? " is-new" : ""}`}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: phase === "ended" ? (age === 0 ? 1 : 0.7) : age === 0 ? 1 : age === 1 ? 0.6 : age === 2 ? 0.4 : 0.25, y: 0 }}
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
    </CardFrame>
  );
}
