/**
 * The answer to "how much is <food>?": one small product card with the photo, today's Rohlík price and the
 * cheapest nearby deal. Comes from the bridge's `product` event (show_product, bridge/show.py), leaves on its own.
 */
import type { BusEvent } from "../stage/bus";
import "./product.css";

const czk = (n: number) =>
  `${n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč`;

export function ProductCard({ ev }: { ev: BusEvent }) {
  const deal = ev.deal as { store: string; price_czk: number; was_czk: number | null; per: string | null } | null;
  const off = deal?.was_czk ? Math.round(((deal.was_czk - deal.price_czk) / deal.was_czk) * 100) : 0;
  return (
    <article className="pc">
      <div className="pc-photo">
        {ev.image_url ? <img src={String(ev.image_url)} alt="" /> : <span className="pc-photo-empty" />}
      </div>
      <h2 className="pc-item">{String(ev.item)}</h2>
      {ev.product ? <p className="pc-product">{String(ev.product)}</p> : null}
      <p className="pc-price">
        <strong>{czk(Number(ev.price_czk))}</strong>
        <span>Rohlík</span>
      </p>
      {deal ? (
        <p className="pc-deal">
          {czk(deal.price_czk)}
          {deal.per ? ` per ${deal.per}` : ""} at {deal.store}
          {off > 0 ? <span className="pc-off">−{off} %</span> : null}
        </p>
      ) : null}
    </article>
  );
}
