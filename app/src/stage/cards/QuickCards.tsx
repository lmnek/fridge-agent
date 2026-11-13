// Honza's quick answers on the stage panel, as they are on the kitchen page: the price card (`product`, show_product)
// and the nearby shops map (`nearby`, show_nearby). His components unchanged, centred in the 800x800 box and
// scaled up for the projector.
import type { BusEvent } from "../bus";
import { NearbyCard } from "../../kitchen/NearbyCard";
import { ProductCard } from "../../kitchen/ProductCard";
import { latest } from "./ui";
import "./QuickCards.css";

export function ProductQuick({ events }: { events: BusEvent[] }) {
  const ev = latest(events, "product");
  return <div className="ck-quick is-product">{ev ? <ProductCard key={ev.ts} ev={ev} /> : null}</div>;
}

export function NearbyQuick({ events }: { events: BusEvent[] }) {
  const ev = latest(events, "nearby");
  return <div className="ck-quick is-nearby">{ev ? <NearbyCard key={ev.ts} ev={ev} /> : null}</div>;
}
