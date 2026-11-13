/**
 * The answer to "how much is <food>?": one small product card with the photo, today's Rohlík price and the
 * cheapest nearby deal. Comes from the bridge's `product` event (show_product, bridge/show.py), leaves on its own.
 */
import { motion } from "motion/react";
import type { BusEvent } from "../stage/bus";
import "./product.css";

const czk = (n: number) =>
  `${n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč`;

export function ProductCard({ ev }: { ev: BusEvent }) {
  const deal = ev.deal as { store: string; price_czk: number; was_czk: number | null; per: string | null } | null;
  const off = deal?.was_czk ? Math.round(((deal.was_czk - deal.price_czk) / deal.was_czk) * 100) : 0;
  return (
    <motion.article
      className="pc"
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
    >
      <div className="pc-photo">{ev.image_url ? <img src={String(ev.image_url)} alt="" /> : null}</div>
      <div className="pc-body">
        <h2 className="pc-item">{String(ev.item)}</h2>
        {ev.product ? <p className="pc-product">{String(ev.product)}</p> : null}
        <p className="pc-price">
          {czk(Number(ev.price_czk))}
          <span>at Rohlík</span>
        </p>
        {deal ? (
          <div className="pc-deal">
            <span className="pc-store">{deal.store}</span>
            <span className="pc-deal-price">
              {czk(deal.price_czk)}
              {deal.per ? <small> / {deal.per}</small> : null}
            </span>
            {off > 0 ? <span className="pc-off">−{off} %</span> : null}
          </div>
        ) : null}
      </div>
    </motion.article>
  );
}
