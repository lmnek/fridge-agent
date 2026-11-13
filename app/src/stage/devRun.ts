/**
 * HACK(demo): the whole A–H run as bus events, with millisecond offsets that follow docs/DEMO.md timing.
 * The dev player (?dev) plays this until part 2's `cards/fixtures.ts` lands (same shape), and a recording
 * from a real run replaces both later. Field shapes follow the bus table in docs/handoffs/README.md.
 */
import type { BusEvent } from "./bus";

export type Step = { at: number; event: BusEvent };

/** Where each beat starts in the run (ms), per DEMO.md. The player uses it for the beat letter and [ / ]. */
export const BEATS: { beat: string; at: number }[] = [
  { beat: "A", at: 0 },
  { beat: "B", at: 10_000 },
  { beat: "C", at: 40_000 },
  { beat: "DE", at: 80_000 },
  { beat: "F", at: 95_000 },
  { beat: "G", at: 145_000 },
  { beat: "H", at: 165_000 },
];
export const RUN_END = 180_000;

const run: Step[] = [];
const at = (t: number, event: BusEvent) => run.push({ at: t, event });

/** One utterance: growing partial captions with the same id, then a final, spread over `ms`. */
function say(t: number, who: string, id: string, text: string, ms = text.length * 55) {
  const words = text.split(" ");
  const chunk = Math.max(1, Math.ceil(words.length / 6));
  const steps = Math.ceil(words.length / chunk);
  for (let i = 1; i < steps; i++) {
    at(t + Math.round((ms * i) / steps), { type: "caption", who, id, text: words.slice(0, i * chunk).join(" "), final: false });
  }
  at(t + ms, { type: "caption", who, id, text, final: true });
}

const tool = (t: number, name: string, args: Record<string, unknown>, ms = 600) => {
  at(t, { type: "tool", name, args, phase: "start" });
  at(t + ms, { type: "tool", name, args, phase: "done", ok: true });
};

// ---- A: opener (0:00–0:10)
at(0, { type: "stage", beat: "A" });
say(
  500,
  "presenter",
  "a-1",
  "This is Coldex, an autonomous agent that runs your fridge: what's inside, what you eat, and what gets ordered. Let's watch it work.",
  8000,
);

// ---- B: kitchen (0:10–0:40)
at(10_000, { type: "stage", beat: "B" });
at(16_000, { type: "look", reason: "replay" });
const frames = [
  { when: "before", camera: "top", url: "/demo/b-before.jpg" },
  { when: "after", camera: "top", url: "/demo/b-after.jpg" },
];
at(16_400, { type: "vision", phase: "captured", run: "dev-b", reason: "replay", frames });
at(17_400, { type: "vision", phase: "analysing", run: "dev-b", reason: "replay", frames });
at(20_400, {
  type: "vision",
  phase: "done",
  run: "dev-b",
  reason: "replay",
  frames,
  boxes: [
    { frame: 0, label: "milk", status: "out", x: 0.12, y: 0.22, w: 0.14, h: 0.38 },
    { frame: 0, label: "eggs", status: "out", x: 0.48, y: 0.58, w: 0.26, h: 0.16 },
  ],
  removed: ["milk", "eggs"],
  added: [],
  tell: "The milk and the eggs were taken out. That was the last of both.",
});
say(21_000, "coldex", "b-1", "That was the last of the milk and the eggs.", 2600);
say(25_000, "actor", "b-2", "Ugh, again. And I'm craving carbonara tonight.", 3200);
tool(29_000, "remember", { fact: "carbonara tonight", category: "craving" });
at(29_600, { type: "learned", fact: "carbonara tonight", category: "craving" });
say(29_400, "coldex", "b-3", "They're going in the next order. Noted, carbonara.", 3000);

// ---- C: order (0:40–1:20). The tools drive the cards, no stage beat.
say(41_000, "presenter", "c-1", "Let's order now, please.", 1600);
tool(43_500, "get_inventory", {}, 500);
at(44_000, {
  type: "inventory",
  source: "camera",
  items: [
    { name: "Greek yogurt", qty: "1 cup", expires: "2026-11-14", note: "use tonight" },
    { name: "Butter", qty: "250 g", expires: "2026-12-13" },
    { name: "Pecorino romano", qty: "150 g", expires: "2026-12-03" },
    { name: "Baby spinach", qty: "1 bag", expires: "2026-11-15" },
    { name: "Cherry tomatoes", qty: "250 g", expires: "2026-11-18" },
  ],
});
say(
  45_000,
  "coldex",
  "c-2",
  "Ordering three things. What just ran out: milk, lactose-free as always, and eggs, which carbonara needs anyway. For tonight: guanciale and spaghetti, with a gluten-free pack for Anna. And your weekly basics: yogurt, and bananas, which are on sale today. Lidl is 400 m away, but Rohlík delivers within the hour, so Rohlík. 812 Kč, ordering now.",
  30_000,
);
tool(49_000, "show_recipe", { title: "Spaghetti carbonara" }, 500);
at(49_500, {
  type: "recipe",
  recipe: {
    title: "Spaghetti carbonara",
    have: ["pecorino romano", "black pepper"],
    missing: ["eggs", "guanciale", "spaghetti"],
    steps: [
      "Crisp the guanciale in a dry pan.",
      "Whisk the eggs with grated pecorino and pepper.",
      "Cook the spaghetti, keep a cup of the water.",
      "Off the heat, toss the pasta with the guanciale, then the egg mix, loosen with pasta water.",
    ],
  },
});
tool(56_000, "show_shops", { items: ["milk", "eggs", "guanciale", "spaghetti", "yogurt", "bananas"] }, 500);
at(56_500, {
  type: "deals",
  scraped_at: "2026-11-13T13:05:00",
  stores: [
    { name: "Rohlík", distance_m: 0, eta: "within the hour" },
    { name: "Lidl", distance_m: 400 },
    { name: "Billa", distance_m: 650 },
  ],
  items: [
    { item: "bananas", store: "Rohlík", price_czk: 31.9, was_czk: 39.9 },
    { item: "bananas", store: "Lidl", price_czk: 34.9, was_czk: null },
    { item: "lactose-free milk", store: "Rohlík", price_czk: 32.9, was_czk: null },
    { item: "lactose-free milk", store: "Lidl", price_czk: 29.9, was_czk: null },
    { item: "eggs", store: "Rohlík", price_czk: 69.9, was_czk: null },
    { item: "eggs", store: "Billa", price_czk: 74.9, was_czk: null },
    { item: "guanciale", store: "Rohlík", price_czk: 129, was_czk: null },
    { item: "spaghetti", store: "Lidl", price_czk: 32.9, was_czk: null },
  ],
});
tool(64_000, "show_cart", {}, 500);
at(64_500, {
  type: "cart",
  total_czk: 812,
  items: [
    { name: "Lactose-free milk 1 l", qty: 2, price_czk: 32.9, reason: "ran out · lactose-free", image_url: "/demo/cart-milk.jpg" },
    { name: "Eggs, 10 pcs", qty: 1, price_czk: 69.9, reason: "ran out · for carbonara", image_url: "/demo/cart-eggs.jpg" },
    { name: "Guanciale 150 g", qty: 1, price_czk: 129, reason: "for carbonara", image_url: "/demo/cart-guanciale.jpg" },
    { name: "Spaghetti 500 g", qty: 1, price_czk: 44.9, reason: "for carbonara", image_url: "/demo/cart-spaghetti.jpg" },
    { name: "Gluten-free spaghetti 400 g", qty: 1, price_czk: 89.9, reason: "gluten-free · Anna", image_url: "/demo/cart-gf-spaghetti.jpg" },
    { name: "Greek yogurt", qty: 4, price_czk: 29.9, reason: "weekly", image_url: "/demo/cart-yogurt.jpg" },
    { name: "Bananas 1 kg", qty: 2, price_czk: 31.9, reason: "weekly · −20 % sale", image_url: "/demo/cart-bananas.jpg" },
  ],
});

// ---- D/E: fast forward (1:20–1:35), a recording
at(80_000, { type: "stage", beat: "DE" });

// ---- F: courier call (1:35–2:25)
const number = "+420 *** *** 123";
at(95_000, { type: "call", phase: "dialing", number });
at(97_000, { type: "call", phase: "ringing", number });
at(103_000, { type: "call", phase: "answered", number });
say(104_000, "courier", "f-1", "Hello?", 800);
say(
  106_000,
  "coldex",
  "f-2",
  "Hi, this is Kryštof's agent. You're delivering his Rohlík order. Skip the door and come straight onto the stage.",
  7000,
);
say(114_500, "courier", "f-3", "Okay, sure, I'm coming up.", 1800);
say(117_500, "coldex", "f-4", "Thank you, see you there.", 1500);
at(121_000, { type: "call", phase: "ended", number });

// ---- G: courier walks on (2:25–2:45)
at(145_000, { type: "stage", beat: "G" });

// ---- H: close (2:45–3:00)
say(166_000, "presenter", "h-1", "It noticed, decided, ordered and called. We just opened the fridge.", 4500);
at(171_000, { type: "stage", beat: "H" });
say(171_500, "presenter", "h-2", "And you can do all of this from your pocket.", 3000);

export const demoRun: Step[] = run.sort((a, b) => a.at - b.at);
