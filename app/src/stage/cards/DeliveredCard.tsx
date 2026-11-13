// G: the courier is on stage. A check mark that draws itself, and "Delivered".
import { motion } from "motion/react";
import type { BusEvent } from "../bus";
import { CardFrame, latest } from "./ui";
import "./DeliveredCard.css";

const ago = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
};

export default function DeliveredCard({ events }: { events: BusEvent[] }) {
  const g = latest(events, "stage", (e) => e.beat === "G");
  const de = latest(events, "stage", (e) => e.beat === "DE");
  const line = g?.ts && de?.ts && g.ts > de.ts ? `Ordered ${ago(g.ts - de.ts)} ago` : undefined;

  return (
    <CardFrame icon="G" kicker="Rohlík order" title="The courier is here" live={false}>
      <div className="ck-delivered">
        <svg viewBox="0 0 120 120" className="ck-delivered-mark" aria-hidden>
          <motion.circle cx="60" cy="60" r="54" fill="none" stroke="var(--ck-ok)" strokeWidth="3" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: [0.65, 0, 0.35, 1] }} />
          <motion.path d="M34 62l17 17 36-39" fill="none" stroke="var(--ck-ok)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 0.8, ease: "easeOut" }} />
        </svg>
        <motion.p className="ck-delivered-word" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3, type: "spring", stiffness: 260, damping: 30 }}>
          Delivered
        </motion.p>
        {line && (
          <motion.p className="ck-delivered-line" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.7 }}>
            {line}
          </motion.p>
        )}
      </div>
    </CardFrame>
  );
}
