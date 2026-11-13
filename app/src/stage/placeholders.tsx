/**
 * Stand-in cards until part 2's `cards/index.ts` lands (Panel.tsx swaps them out automatically).
 * Each shows its title and the newest event that drives it, so the switching can be checked end to end.
 */
import type { ComponentType } from "react";
import type { BusEvent } from "./bus";
import { type CardId, cardFor } from "./pick";

const TITLES: Record<CardId, string> = {
  B: "What the camera saw",
  C1: "Fridge check",
  C2: "Carbonara",
  C3: "Where to buy",
  C4: "Cart",
  DE: "Rohlík checkout",
  F: "Calling the courier",
  G: "Delivered",
  PR: "Price",
  NB: "Nearby shops",
  OR: "Your order",
};

function placeholder(id: CardId): ComponentType<{ events: BusEvent[] }> {
  return function Placeholder({ events }) {
    const mine = events.filter((e) => cardFor(e) === id);
    const last = mine.at(-1);
    return (
      <div className="ph-card">
        <p className="ph-id">{id}</p>
        <h2 className="ph-title">{TITLES[id]}</h2>
        {last ? <pre className="ph-event">{summary(last)}</pre> : null}
        <p className="ph-count">{mine.length} events</p>
      </div>
    );
  };
}

function summary(ev: BusEvent): string {
  const { ts: _ts, ...rest } = ev;
  return JSON.stringify(rest, null, 2).slice(0, 700);
}

export const placeholders = Object.fromEntries(
  (Object.keys(TITLES) as CardId[]).map((id) => [id, placeholder(id)]),
) as Record<CardId, ComponentType<{ events: BusEvent[] }>>;
