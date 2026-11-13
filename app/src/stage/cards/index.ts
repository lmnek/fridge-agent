// Side panel cards (part 2). Contract: docs/handoffs/README.md, "Stage contract".
// Each card gets the whole event list and derives its own state from it. Cards render their own surface
// and fill whatever box the panel gives them (designed for a 1920x1080 projector).
// Which card shows is part 1's call (app/src/stage/pick.ts).
import type { ComponentType } from "react";
import type { BusEvent } from "../bus";
import VisionCard from "./VisionCard";
import FridgeCard from "./FridgeCard";
import RecipeCard from "./RecipeCard";
import ShopsCard from "./ShopsCard";
import CartCard from "./CartCard";
import CheckoutCard from "./CheckoutCard";
import CallCard from "./CallCard";
import DeliveredCard from "./DeliveredCard";

export type CardId = "B" | "C1" | "C2" | "C3" | "C4" | "DE" | "F" | "G";

export const cards: Record<CardId, ComponentType<{ events: BusEvent[] }>> = {
  B: VisionCard,
  C1: FridgeCard,
  C2: RecipeCard,
  C3: ShopsCard,
  C4: CartCard,
  DE: CheckoutCard,
  F: CallCard,
  G: DeliveredCard,
};
