// G: the courier is on stage. A check mark draws itself next to "Delivered", then a short receipt closes the story:
// what was ordered, the courier call, how long from "order now" to the door, and the total.
import { motion } from "motion/react";
import type { BusEvent } from "../bus";
import { CardFrame, czk, latest, rise } from "./ui";
import "./DeliveredCard.css";

const dur = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

type Item = { qty?: number };

// The receipt rises in after the check has drawn and the word has landed.
const receipt = { hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 1.5 } } };

export default function DeliveredCard({ events }: { events: BusEvent[] }) {
  const g = latest(events, "stage", (e) => e.beat === "G");
  // "Let's order now" opens beat C; fall back to the cart if the beat marker is missing.
  const start = latest(events, "stage", (e) => e.beat === "C") ?? latest(events, "cart");
  const cart = latest(events, "cart");
  const answered = latest(events, "call", (e) => e.phase === "answered");
  const ended = latest(events, "call", (e) => e.phase === "ended");

  const items = (cart?.items as Item[] | undefined) ?? [];
  const pieces = items.reduce((n, i) => n + (i.qty ?? 1), 0);
  const rows: { label: string; value: string }[] = [];
  if (items.length) rows.push({ label: "Ordered", value: `${items.length} items, ${pieces} pieces` });
  if (answered?.ts && ended?.ts && ended.ts > answered.ts) rows.push({ label: "Courier call", value: dur(ended.ts - answered.ts) });
  if (g?.ts && start?.ts && g.ts > start.ts) rows.push({ label: "Order to door", value: dur(g.ts - start.ts) });
  const total = typeof cart?.total_czk === "number" ? (cart.total_czk as number) : undefined;

  return (
    <CardFrame icon="G" kicker="Rohlík order" title="The courier is here" live={false}>
      <div className="ck-delivered">
        <div className="ck-delivered-hero">
          <svg viewBox="0 0 120 120" className="ck-delivered-mark" aria-hidden>
            <motion.circle cx="60" cy="60" r="56" fill="var(--ck-ok-soft)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.5 }} />
            <motion.circle cx="60" cy="60" r="56" fill="none" stroke="var(--ck-ok)" strokeWidth="3" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: [0.65, 0, 0.35, 1] }} />
            <motion.path d="M36 62l16 16 33-36" fill="none" stroke="var(--ck-ok)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.55, delay: 0.8, ease: "easeOut", opacity: { duration: 0.01, delay: 0.8 } }} />
          </svg>
          <motion.p className="ck-delivered-word" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.1, type: "spring", stiffness: 260, damping: 30 }}>
            Delivered
          </motion.p>
        </div>
        {(rows.length > 0 || total !== undefined) && (
          <motion.dl className="ck-receipt" variants={receipt} initial="hidden" animate="show">
            {rows.map((r) => (
              <motion.div key={r.label} className="ck-receipt-row" variants={rise}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </motion.div>
            ))}
            {total !== undefined && (
              <motion.div className="ck-receipt-row is-total" variants={rise}>
                <dt>Total</dt>
                <dd>{czk(total)}</dd>
              </motion.div>
            )}
          </motion.dl>
        )}
      </div>
    </CardFrame>
  );
}
