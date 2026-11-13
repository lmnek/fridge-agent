/**
 * "Add red peppers to my order": the simulated order on the kitchen screen, filled by voice (add_to_order,
 * bridge/show.py). The new line slides in, the total ticks over, and the card leaves on its own like the others.
 */
import { AnimatePresence, motion } from "motion/react";
import type { BusEvent } from "../stage/bus";
import "./product.css";

type Line = { id: number; item: string; product: string; price_czk: number; qty: number; image_url: string };

const czk = (n: number) =>
  `${n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč`;
const SPRING = { type: "spring", stiffness: 320, damping: 30 } as const;
const SHOWN = 6; // the newest lines, the card keeps its height

export function OrderCard({ ev }: { ev: BusEvent }) {
  const items = (ev.items as Line[]) ?? [];
  const total = Number(ev.total_czk ?? 0);
  const count = items.reduce((n, i) => n + i.qty, 0);
  return (
    <motion.article
      className="pc oc"
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
    >
      <header className="oc-head">
        <h2 className="pc-item">Your order</h2>
        <span className="oc-count">{count === 1 ? "1 item" : `${count} items`}</span>
      </header>
      <ul className="oc-list">
        <AnimatePresence initial={false}>
          {items.slice(-SHOWN).map((i) => (
            <motion.li
              layout
              key={i.id}
              className="oc-row"
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              transition={SPRING}
            >
              {i.id === ev.added ? (
                <motion.span
                  key={`${ev.ts}`}
                  className="oc-flash"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 1.6, ease: "easeOut" }}
                />
              ) : null}
              <span className="oc-thumb">{i.image_url ? <img src={i.image_url} alt="" /> : null}</span>
              <span className="oc-text">
                <span className="oc-name">{i.item}</span>
                <span className="oc-product">{i.product}</span>
              </span>
              <motion.span key={i.qty} className="oc-qty" initial={{ scale: 1.4 }} animate={{ scale: 1 }} transition={SPRING}>
                {i.qty}×
              </motion.span>
              <span className="oc-price">{czk(i.price_czk * i.qty)}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <motion.div layout className="oc-total">
        <span>Total</span>
        <motion.span key={total} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
          {czk(total)}
        </motion.span>
      </motion.div>
    </motion.article>
  );
}
