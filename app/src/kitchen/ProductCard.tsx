/**
 * The answer to "where is <food> cheapest?": one small product card with the photo, the price and the shop near
 * the flat that has it cheapest today (shop leaflets). From the bridge's `product` event (show_product,
 * bridge/show.py), leaves on its own.
 */
import { motion } from "motion/react";
import type { BusEvent } from "../stage/bus";
import "./product.css";

const czk = (n: number) =>
  `${n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč`;

const dist = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} km`);

export function ProductCard({ ev }: { ev: BusEvent }) {
  const price = Number(ev.price_czk);
  const was = ev.was_czk ? Number(ev.was_czk) : 0;
  const off = was > price ? Math.round(((was - price) / was) * 100) : 0;
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
          {czk(price)}
          {off > 0 ? <span className="pc-off">−{off} %</span> : null}
        </p>
        {was > price ? <p className="pc-was">was {czk(was)}</p> : null}
        <div className="pc-deal">
          <span className="pc-store">{String(ev.store)}</span>
          {ev.distance_m != null ? <span className="pc-deal-price">{dist(Number(ev.distance_m))} away</span> : null}
        </div>
      </div>
    </motion.article>
  );
}
