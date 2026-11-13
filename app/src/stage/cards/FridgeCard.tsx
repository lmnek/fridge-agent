import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { BusEvent } from "../bus";
import { fridgeAfterB } from "./fixtures"; // HACK(demo): last-resort contents if no inventory event and no API
import { CardFrame, Tag, latest, rise, stagger } from "./ui";
import "./FridgeCard.css";

type Item = { id?: string; name: string; qty?: string; expires?: string | null; note?: string | null };

// HACK(demo): mirrors "Always in the fridge" in bridge/memory/household.md. `key` is matched inside item names.
const STAPLES = [
  { key: "milk", name: "Lactose-free milk" },
  { key: "egg", name: "Eggs" },
  { key: "butter", name: "Butter" },
  { key: "pecorino", name: "Pecorino romano" },
  { key: "yogurt", name: "Greek yogurt" },
];

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}

function expiry(days: number | null): { text: string; soon: boolean } {
  if (days === null) return { text: "", soon: false };
  if (days < 0) return { text: "expired", soon: true };
  if (days === 0) return { text: "expires today", soon: true };
  if (days === 1) return { text: "expires tomorrow", soon: true };
  return { text: `in ${days} days`, soon: false };
}

const Cross = () => (
  <svg width="28" height="28" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
    <path d="M6 6l14 14M20 6L6 20" />
  </svg>
);

export default function FridgeCard({ events }: { events: BusEvent[] }) {
  const inv = latest(events, "inventory");
  const [fetched, setFetched] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (inv) return;
    fetch("/api/inventory")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setFetched(Array.isArray(j) ? j : j.items))
      .catch(() => setFailed(true));
  }, [!!inv]); // eslint-disable-line react-hooks/exhaustive-deps

  const items: Item[] | null = inv ? inv.items : fetched ?? (failed ? (fridgeAfterB as Item[]) : null); // HACK(demo) fallback
  const vision = latest(events, "vision", (e) => e.phase === "done");
  const removed: string[] = vision?.removed ?? [];

  if (!items) return <CardFrame icon="C1" kicker="Fridge check" title="Looking inside" live />;

  const has = (key: string) => items.some((i) => i.name.toLowerCase().includes(key));
  const out: string[] = STAPLES.filter((s) => !has(s.key)).map((s) => s.name);
  for (const r of removed) {
    const staple = STAPLES.find((s) => r.toLowerCase().includes(s.key));
    if (!staple && !has(r.toLowerCase()) && !out.includes(r)) out.push(r);
  }

  const sorted = [...items].sort((a, b) => (daysUntil(a.expires) ?? 999) - (daysUntil(b.expires) ?? 999));
  const count = out.length;
  const title = count ? `${count === 1 ? "One thing" : count === 2 ? "Two things" : `${count} things`} ran out` : "Nothing ran out";

  return (
    <CardFrame icon="C1" kicker="Fridge check" title={title} live={false} aside={`${items.length} items inside`}>
      <motion.div className="ck-fridge-body" variants={stagger} initial="hidden" animate="show">
        {count > 0 && (
          <div className="ck-fridge-out">
            {out.map((n) => (
              <motion.div key={n} variants={rise} className="ck-fridge-outrow">
                <span className="ck-fridge-x"><Cross /></span>
                <span className="ck-fridge-outname">{n}</span>
                <Tag tone="gone">ran out</Tag>
              </motion.div>
            ))}
          </div>
        )}
        <p className="ck-fridge-label">Still inside</p>
        <ul className="ck-fridge-list">
          {sorted.map((i) => {
            const ex = expiry(daysUntil(i.expires));
            return (
              <motion.li key={i.id ?? i.name} variants={rise} className="ck-fridge-row">
                <span className="ck-fridge-name">{i.name}</span>
                <span className="ck-fridge-qty">{i.qty}</span>
                <span className={`ck-fridge-exp${ex.soon ? " soon" : ""}`}>{ex.soon && i.note ? i.note : ex.text}</span>
              </motion.li>
            );
          })}
        </ul>
      </motion.div>
    </CardFrame>
  );
}
