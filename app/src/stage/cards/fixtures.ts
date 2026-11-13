// HACK(demo): the whole A–H run as bus events, timed after docs/DEMO.md. Part 1's dev player plays it, and
// the cards are built against it. A recording of a real run from the bus replaces it later.
// Shapes follow the event table in docs/handoffs/README.md.
import type { BusEvent } from "../bus";

export type Timed = { at: number; event: BusEvent };

const s = (sec: number) => Math.round(sec * 1000);

/** A caption that streams in two words at a time over `dur` seconds, then lands as final. */
function say(at: number, who: string, id: string, text: string, dur: number): Timed[] {
  const words = text.split(" ");
  const out: Timed[] = [];
  const steps = Math.ceil(words.length / 2);
  for (let i = 1; i < steps; i++) {
    out.push({ at: s(at + (dur * i) / steps), event: { type: "caption", who, id, text: words.slice(0, i * 2).join(" "), final: false } });
  }
  out.push({ at: s(at + dur), event: { type: "caption", who, id, text, final: true } });
  return out;
}

/** A tool call as the bridge publishes it: start, then done. */
function tool(at: number, name: string, args: Record<string, unknown> = {}, dur = 0.2): Timed[] {
  return [
    { at: s(at), event: { type: "tool", name, args, phase: "start" } },
    { at: s(at + dur), event: { type: "tool", name, args, phase: "done", ok: true } },
  ];
}

const at = (sec: number, event: BusEvent): Timed => ({ at: s(sec), event });

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

// The fridge after the actor took the milk and the eggs (the bridge's `inventory` item shape).
export const fridgeAfterB = [
  { id: "i-yog", name: "Greek yogurt", qty: "1 cup", expires: day(1), note: "use tonight" },
  { id: "i-but", name: "Butter", qty: "250 g", expires: day(30), note: null },
  { id: "i-pec", name: "Pecorino romano", qty: "150 g", expires: day(20), note: null },
  { id: "i-spi", name: "Baby spinach", qty: "1 bag", expires: day(2), note: null },
  { id: "i-tom", name: "Cherry tomatoes", qty: "250 g", expires: day(5), note: null },
];

// B: what bridge/vision.py publishes. Frames are before and after per camera. Boxes are 0–1 on the frame they
// belong to (top-left x, y, w, h), with status out (on a before frame), new or in.
// HACK(demo): stand-in frames until real Reolink frames from rehearsal land in app/public/demo/b/.
const run = "131500-demo";
const frames = [
  { when: "before", camera: "top", url: "/demo/b/before_top.jpg" },
  { when: "before", camera: "door", url: "/demo/b/before_door.jpg" },
  { when: "after", camera: "top", url: "/demo/b/after_top.jpg" },
  { when: "after", camera: "door", url: "/demo/b/after_door.jpg" },
];
const boxes = [
  { frame: 1, label: "Lactose-free milk", status: "out", x: 0.34, y: 0.18, w: 0.2, h: 0.52 },
  { frame: 0, label: "Eggs", status: "out", x: 0.56, y: 0.56, w: 0.3, h: 0.16 },
  { frame: 2, label: "Greek yogurt", status: "in", x: 0.12, y: 0.54, w: 0.16, h: 0.18 },
  { frame: 2, label: "Pecorino romano", status: "in", x: 0.32, y: 0.6, w: 0.2, h: 0.12 },
  { frame: 2, label: "Butter", status: "in", x: 0.12, y: 0.22, w: 0.18, h: 0.1 },
  { frame: 2, label: "Baby spinach", status: "in", x: 0.36, y: 0.16, w: 0.3, h: 0.2 },
  { frame: 2, label: "Cherry tomatoes", status: "in", x: 0.7, y: 0.2, w: 0.18, h: 0.15 },
];
const removed = ["Lactose-free milk", "Eggs"];

// C2
export const carbonara = {
  title: "Carbonara",
  have: ["Pecorino romano", "Black pepper", "Salt"],
  missing: ["Eggs", "Guanciale", "Spaghetti", "Gluten-free spaghetti"],
  steps: [
    "Crisp the guanciale in a dry pan.",
    "Whisk the eggs with grated pecorino and pepper.",
    "Cook both pastas in separate pots.",
    "Toss the pasta off the heat with the egg mix and guanciale.",
  ],
};

// C3. Rohlík has no distance, it delivers: `delivery_min` is an extra field for it.
export const deals = {
  items: [
    { item: "Lactose-free milk", store: "Rohlík", price_czk: 34, was_czk: null },
    { item: "Lactose-free milk", store: "Lidl", price_czk: 29.9, was_czk: null },
    { item: "Lactose-free milk", store: "Albert", price_czk: 36.9, was_czk: null },
    { item: "Eggs", store: "Rohlík", price_czk: 89, was_czk: null },
    { item: "Eggs", store: "Lidl", price_czk: 79.9, was_czk: null },
    { item: "Eggs", store: "Albert", price_czk: 92.9, was_czk: null },
    { item: "Guanciale", store: "Rohlík", price_czk: 189, was_czk: null },
    { item: "Spaghetti", store: "Rohlík", price_czk: 49, was_czk: null },
    { item: "Spaghetti", store: "Lidl", price_czk: 44.9, was_czk: null },
    { item: "Spaghetti", store: "Albert", price_czk: 52.9, was_czk: null },
    { item: "Gluten-free spaghetti", store: "Rohlík", price_czk: 78, was_czk: null },
    { item: "Gluten-free spaghetti", store: "Albert", price_czk: 84.9, was_czk: null },
    { item: "Greek yogurt", store: "Rohlík", price_czk: 59, was_czk: null },
    { item: "Greek yogurt", store: "Lidl", price_czk: 49.9, was_czk: 59.9 },
    { item: "Greek yogurt", store: "Albert", price_czk: 64.9, was_czk: null },
    { item: "Bananas", store: "Rohlík", price_czk: 47, was_czk: 59 },
    { item: "Bananas", store: "Lidl", price_czk: 39.9, was_czk: null },
    { item: "Bananas", store: "Albert", price_czk: 44.9, was_czk: null },
  ],
  stores: [
    { name: "Rohlík", distance_m: null, delivery_min: 60 },
    { name: "Lidl", distance_m: 400 },
    { name: "Albert", distance_m: 700 },
  ],
  scraped_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
};

// C3: bridge/show.py's show_shops publishes `deals` plus the model's choice and why.
const shops = { choice: "Rohlík", why: "Lidl is 400 m away, but Rohlík delivers within the hour." };

// C4. `price_czk` is per unit. `reason` is the why tags, comma-separated.
export const cart = {
  items: [
    { name: "Kunín lactose-free milk 1.5 %, 1 l", qty: 4, price_czk: 34, reason: "ran out, lactose-free", image_url: "/demo/products/milk.jpg" },
    { name: "Eggs M, 10 pcs", qty: 1, price_czk: 89, reason: "ran out, for carbonara", image_url: "/demo/products/eggs.jpg" },
    { name: "Guanciale, 200 g", qty: 1, price_czk: 189, reason: "for carbonara", image_url: "/demo/products/guanciale.jpg" },
    { name: "Barilla Spaghetti n.5, 500 g", qty: 1, price_czk: 49, reason: "for carbonara", image_url: "/demo/products/spaghetti.jpg" },
    { name: "Barilla gluten-free spaghetti, 400 g", qty: 1, price_czk: 78, reason: "gluten-free · Anna", image_url: "/demo/products/spaghetti-gf.jpg" },
    { name: "Olympus Greek yogurt 2 %, 500 g", qty: 3, price_czk: 59, reason: "weekly", image_url: "/demo/products/yogurt.jpg" },
    { name: "Bananas, 1 kg", qty: 2, price_czk: 47, reason: "weekly, −20 % sale", image_url: "/demo/products/bananas.jpg" },
  ],
  total_czk: 812,
};

export const callNumber = "+420 *** *** 482"; // bridge/courier.py mask()

export const demoRun: Timed[] = [
  // A: opener (0:00–0:10)
  at(0, { type: "stage", beat: "A", action: "reset" }),
  ...say(1, "presenter", "a-1", "This is Coldex, an autonomous agent that runs your fridge: what's inside, what you eat, and what gets ordered. Let's watch it work.", 8),

  // B: kitchen (0:10–0:40)
  at(10, { type: "stage", beat: "B", action: "start" }),
  at(22, { type: "look", reason: "motion" }),
  at(22.3, { type: "vision", phase: "captured", run, reason: "motion", frames }),
  at(22.4, { type: "vision", phase: "analysing", run }),
  at(26.5, {
    type: "vision",
    phase: "done",
    run,
    frames,
    boxes,
    removed,
    added: [],
    lit: true,
    seconds: 4.1,
    tell: "[camera] The fridge door just closed. Vision saw these taken out: Lactose-free milk, Eggs. Update the inventory, then react briefly.",
  }),
  ...tool(26.7, "update_inventory", { removed: [{ name: "Lactose-free milk" }, { name: "Eggs" }], source: "camera" }),
  at(26.8, { type: "inventory", items: fridgeAfterB, source: "camera" }),
  ...say(27.5, "coldex", "b-1", "That was the last of the milk and the eggs.", 2.5),
  ...say(30.2, "actor", "b-2", "Coldex, we're out of milk and eggs again and I'm craving carbonara, so order what we need.", 4),
  at(34, { type: "tool", name: "remember", args: { fact: "Craving carbonara tonight", category: "craving" }, phase: "start" }),
  at(34.1, { type: "learned", fact: "Craving carbonara tonight", category: "craving" }),
  at(34.2, { type: "tool", name: "remember", args: { fact: "Craving carbonara tonight", category: "craving" }, phase: "done", ok: true }),
  ...say(34.5, "coldex", "b-3", "They're going in the next order. Noted, carbonara.", 3),

  // C: order (0:40–1:20)
  at(40, { type: "stage", beat: "C", action: "start" }),
  // Part 3's choreography (bridge/memory/instructions.md, "Ordering"): "Ordering three things." with
  // get_inventory and get_household, the whole narration, then show_recipe, show_shops and show_cart in one
  // batch (milliseconds apart), then only the total.
  ...say(43, "coldex", "c-1", "Ordering three things.", 1.5),
  ...tool(43.2, "get_inventory", {}, 0.3),
  ...tool(43.2, "get_household", {}, 0.3),
  ...say(44.8, "coldex", "c-2", "What just ran out: milk, lactose-free as always, and eggs, which carbonara needs anyway.", 5),
  ...say(50, "coldex", "c-3", "For tonight: guanciale and spaghetti, with a gluten-free pack for Anna.", 4.5),
  ...say(54.6, "coldex", "c-4", "And your weekly basics: yogurt, and bananas, which are on sale today.", 4.5),
  ...say(59.2, "coldex", "c-5", "Lidl is 400 m away, but Rohlík delivers within the hour, so Rohlík.", 4.5),
  ...tool(64, "show_recipe", carbonara, 0.01),
  at(64.005, { type: "recipe", recipe: carbonara }),
  ...tool(64.02, "show_shops", shops, 0.01),
  at(64.025, { type: "deals", ...deals, ...shops }),
  ...tool(64.04, "show_cart", cart, 0.01),
  at(64.045, { type: "cart", ...cart }),
  ...say(65.2, "coldex", "c-6", "812 Kč, ordering now.", 2),

  // D/E: fast forward, the recording of the real checkout (1:20–1:35)
  at(80, { type: "stage", beat: "DE", action: "play" }),
  ...say(87, "coldex", "de-1", "Order placed.", 1),
  ...say(91, "coldex", "de-2", "Courier on the way.", 1.2),

  // F: courier call (1:35–2:25)
  at(95, { type: "stage", beat: "F", action: "call" }),
  ...tool(95.2, "call_courier", {}, 0.3),
  at(95.5, { type: "call", phase: "dialing", number: callNumber }),
  at(97.5, { type: "call", phase: "ringing", number: callNumber }),
  at(102, { type: "call", phase: "answered", number: callNumber }),
  ...say(102.5, "courier", "f-1", "Hello?", 0.8),
  ...say(104, "coldex", "f-2", "Hi, this is Kryštof's agent. You're delivering his Rohlík order. Skip the door and come straight onto the stage.", 7),
  ...say(112, "courier", "f-3", "Sorry, onto the stage? In the building?", 3),
  ...say(116, "coldex", "f-4", "Yes, the stage in the main hall. Just walk straight in, the audience is waiting.", 5),
  ...say(122, "courier", "f-5", "Okay, I'm coming up.", 2),
  ...say(125, "coldex", "f-6", "Thank you, see you in a minute.", 2),
  at(128.5, { type: "call", phase: "ended", number: callNumber }),

  // G: the courier walks on (2:25–2:45)
  at(145, { type: "stage", beat: "G", action: "delivered" }),

  // H: close (2:45–3:00)
  at(165, { type: "stage", beat: "H", action: "telegram" }),
  ...say(165.5, "presenter", "h-1", "It noticed, decided, ordered and called. We just opened the fridge.", 4.5),
  ...say(171, "presenter", "h-2", "And you can do all of this from your pocket.", 3),
  at(178, { type: "stage", beat: "idle", action: "idle" }),
].sort((a, b) => a.at - b.at);

/**
 * Every event up to `ms` into the run, which is what a card sees at that moment. Each gets `ts` (epoch ms) as if
 * the run were live right now, like the bus stamps arrivals, so cards can run timers off it.
 */
export function eventsAt(ms: number, now = Date.now()): BusEvent[] {
  return demoRun.filter((t) => t.at <= ms).map((t) => ({ ...t.event, ts: now - (ms - t.at) }));
}
