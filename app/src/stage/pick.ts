/**
 * Which card the side panel shows, and which beat the stage is in. The panel follows the agent's tool calls,
 * not a script: the newest event that maps to a card wins, and a `stage` event with a `beat` forces one.
 */
import type { BusEvent } from "./bus";

// Mirrors app/src/stage/cards/index.ts (part 2). Kept here so the panel builds before the cards land.
export type CardId = "B" | "C1" | "C2" | "C3" | "C4" | "DE" | "F" | "G";
export type PanelId = CardId | "idle";
/** The stage beat drives the layout: the kitchen inset is large in A and B, small from C on. */
export type Beat = "A" | "B" | "C" | "DE" | "F" | "G" | "H";

const FORCED: Record<string, PanelId> = {
  A: "idle",
  idle: "idle",
  H: "idle",
  B: "B",
  C: "C1",
  C1: "C1",
  C2: "C2",
  C3: "C3",
  C4: "C4",
  D: "DE",
  E: "DE",
  DE: "DE",
  F: "F",
  G: "G",
};

const TOOLS: [RegExp, CardId][] = [
  [/^(look|update_inventory|analy[sz]e_fridge|vision.*)$/, "B"],
  [/^get_inventory$/, "C1"],
  [/^show_recipe$/, "C2"],
  [/^(show_shops|.*deals?.*|.*prices?.*|compare_.*)$/, "C3"],
  [/^(show_cart|add_to_cart|view_cart)$/, "C4"],
  [/^(call_courier|.*call.*)$/, "F"],
];

/** The card one event asks for, or null if it doesn't move the panel. */
export function cardFor(ev: BusEvent): PanelId | null {
  switch (ev.type) {
    case "stage":
      return ev.beat ? (FORCED[String(ev.beat)] ?? null) : null;
    case "tool": {
      const name = String(ev.name ?? "");
      if (name === "remember") return ev.args?.category === "craving" ? "B" : null;
      return TOOLS.find(([re]) => re.test(name))?.[1] ?? null;
    }
    case "vision":
    case "look":
      return "B";
    case "learned":
      return ev.category === "craving" ? "B" : null;
    case "recipe":
      return "C2";
    case "deals":
      return "C3";
    case "cart":
      return "C4";
    case "call":
      return "F";
    case "caption":
      return ev.who === "courier" ? "F" : null;
    default:
      return null;
  }
}

/** The newest card asked for, and the index of the event that asked (so a repeat force still counts). */
export function latestCard(events: BusEvent[]): { card: PanelId; at: number; forced: boolean } {
  for (let i = events.length - 1; i >= 0; i--) {
    const card = cardFor(events[i]);
    if (card) return { card, at: i, forced: events[i].type === "stage" };
  }
  return { card: "idle", at: -1, forced: false };
}

/** The beat for the layout. A forced H wins over idle, everything else follows the card. */
export function beatFor(card: PanelId, events: BusEvent[]): Beat {
  if (card !== "idle") return card === "B" ? "B" : card.startsWith("C") ? "C" : (card as Beat);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === "stage" && ev.beat) return ev.beat === "H" ? "H" : "A";
  }
  return "A";
}
