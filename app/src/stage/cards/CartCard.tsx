import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { BusEvent } from "../bus";
import { CardFrame, CountUp, Tag, czk, type Tone } from "./ui";
import "./CartCard.css";

// Pacing. Rows land one by one from the moment the card opens; the total eases to each new running sum.
const LEAD_MS = 300; // the card frame settles first
const ROW_MS = 400; // one row per beat: 7 rows land in under 3 s
const HURRY_MS = 1000; // Coldex says "… Kč" before the rows are in: the rest cascade in within this
const SETTLE_MS = 550; // after the last row, the total settles (colour + hairline)
const ease = [0.16, 1, 0.3, 1] as const;

type Item = { name: string; qty: number; price: number; tags: string[]; image?: string };

// Bridge sends `{items, total_czk}`; the legacy shape is `{cart: [...]}` with no total.
function readCart(ev: BusEvent): { items: Item[]; total: number } {
  const raw: any[] = ev.items ?? ev.cart ?? [];
  const items = raw.map((r) => ({
    name: String(r.name ?? r.title ?? ""),
    qty: Number(r.qty ?? r.quantity ?? 1),
    price: Number(r.price_czk ?? r.price ?? 0),
    tags: String(r.reason ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    image: r.image_url ?? r.image ?? undefined,
  }));
  const total = Number(ev.total_czk ?? items.reduce((s, i) => s + i.qty * i.price, 0));
  return { items, total };
}

// One mapping for every why tag: red = it ran out, amber = money, blue = tonight's dish, green = a household rule.
function tone(tag: string): Tone {
  const t = tag.toLowerCase();
  if (t.includes("ran out") || t.includes("missing")) return "gone";
  if (t.includes("sale") || t.includes("%") || t.includes("cheaper")) return "soon";
  if (t.startsWith("for ")) return "lamp";
  if (/free|vegan|vegetarian|·/.test(t)) return "ok";
  return undefined;
}

function initials(name: string) {
  return name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function Thumb({ src, name }: { src?: string; name: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="ck-cart-thumb">
      {src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : <b>{initials(name)}</b>}
    </span>
  );
}

/** Row i lands at start + LEAD + i*ROW, unless Coldex says the total first: then the rest land within HURRY. */
function schedule(n: number, start: number, hurry: number | null): number[] {
  const at = Array.from({ length: n }, (_, i) => start + LEAD_MS + i * ROW_MS);
  if (hurry === null) return at;
  const left = at.filter((t) => t > hurry).length;
  return at.map((t, i) => (t > hurry ? Math.min(t, Math.round(hurry + ((i - (n - left) + 1) * HURRY_MS) / left)) : t));
}

/** Re-renders at each moment in `times` until they've all passed. */
function useClock(times: number[]) {
  const [now, setNow] = useState(Date.now);
  const next = times.find((t) => t > now);
  // Re-arms on every tick too: a timer that fires a hair early (fractional times) must not stall the clock.
  useEffect(() => {
    if (next === undefined) return;
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, Math.ceil(next - Date.now()) + 1));
    return () => clearTimeout(id);
  }, [next, now]);
  return now;
}

function Building() {
  return (
    <CardFrame icon="C4" kicker="Rohlík cart" title="Building the cart" live>
      <ul className="ck-cart-list is-building">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="ck-cart-row" style={{ animationDelay: `${i * 0.15}s` }}>
            <span className="ck-cart-thumb" />
            <span className="ck-cart-bar" style={{ width: `${62 - i * 7}%` }} />
          </li>
        ))}
      </ul>
    </CardFrame>
  );
}

export default function CartCard({ events }: { events: BusEvent[] }) {
  let cartAt = -1;
  let buildAt = -1;
  for (let i = events.length - 1; i >= 0 && (cartAt < 0 || buildAt < 0); i--) {
    const e = events[i];
    if (cartAt < 0 && e.type === "cart") cartAt = i;
    if (buildAt < 0 && e.type === "tool" && e.name === "show_cart" && e.phase === "start") buildAt = i;
  }
  if (cartAt < 0 || buildAt > cartAt) return <Building />;

  return <Cart events={events} cartAt={cartAt} />;
}

function Cart({ events, cartAt }: { events: BusEvent[]; cartAt: number }) {
  const ev = events[cartAt];
  const { items, total } = readCart(ev);
  const count = items.reduce((s, i) => s + i.qty, 0);

  // The count starts when this cart is first on screen (its event usually arrived seconds earlier).
  const cartTs = typeof ev.ts === "number" ? ev.ts : 0;
  const run = useRef({ key: -1, start: 0 });
  if (run.current.key !== cartTs) run.current = { key: cartTs, start: Math.max(cartTs, Date.now()) };
  const start = run.current.start;

  // Coldex saying the total: the first "Kč" caption after the cart event. If it came while the card waited in
  // the panel's queue (part 3 says the total right after show_cart), the rows hurry from the moment it opens.
  let hurry: number | null = null;
  for (let i = cartAt + 1; i < events.length; i++) {
    const e = events[i];
    if (e.type === "caption" && e.who === "coldex" && typeof e.ts === "number" && /Kč/.test(String(e.text ?? ""))) {
      hurry = Math.max(e.ts, start);
      break;
    }
  }

  const at = schedule(items.length, start, hurry);
  const lastAt = at.length ? at[at.length - 1] : start;
  const now = useClock([...at, lastAt + SETTLE_MS]);
  const landed = at.filter((t) => t <= now).length;
  const done = landed === items.length;
  const settled = now >= lastAt + SETTLE_MS;
  const running = done ? total : items.slice(0, landed).reduce((s, i) => s + i.qty * i.price, 0);

  return (
    <CardFrame
      icon="C4"
      kicker="Rohlík cart"
      title="Tonight's order"
      live={false}
      aside={`${items.length} products, ${count} pcs`}
      foot={
        <div className="ck-cart-foot">
          <p className="ck-cart-note">
            Rohlík delivers within the hour.
            <br />
            You confirm the order in Rohlík.
          </p>
          <span className={`ck-cart-total${settled ? " is-settled" : ""}`}>
            <CountUp to={running} duration={0.6} format={(n) => czk(Math.round(n))} />
          </span>
        </div>
      }
    >
      <ul className="ck-cart-list">
        {items.map((it, i) => (
          <motion.li
            key={`${it.name}-${i}`}
            className="ck-cart-row"
            initial={{ opacity: 0, y: 14 }}
            animate={i < landed ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
            transition={{ duration: 0.5, ease }}
          >
            <Thumb src={it.image} name={it.name} />
            <span className="ck-cart-main">
              <span className={`ck-cart-name${it.name.length > 46 ? " is-longer" : it.name.length > 34 ? " is-long" : ""}`}>{it.name}</span>
              {it.tags.length > 0 && (
                <span className="ck-cart-tags">
                  {it.tags.map((t) => (
                    <Tag key={t} tone={tone(t)}>
                      {t}
                    </Tag>
                  ))}
                </span>
              )}
            </span>
            <span className="ck-cart-qty ck-num">{it.qty} ×</span>
            <span className="ck-cart-price ck-num">{czk(it.qty * it.price)}</span>
          </motion.li>
        ))}
      </ul>
    </CardFrame>
  );
}
