import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { BusEvent } from "../bus";
import { CardFrame, CountUp, Tag, czk, rise, stagger, type Tone } from "./ui";
import "./CartCard.css";

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

/** The total waits until the rows have landed, then counts up. */
function Total({ to, delay, settled }: { to: number; delay: number; settled: boolean }) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setGo(true), delay);
    return () => clearTimeout(id);
  }, [delay]);
  if (settled) return <span className="ck-cart-total"><span className="ck-num">{czk(to)}</span></span>;
  return <span className="ck-cart-total">{go ? <CountUp to={to} duration={1.4} format={(n) => czk(Math.round(n))} /> : <span className="ck-num ck-cart-wait">{czk(0)}</span>}</span>;
}

function Building() {
  return (
    <CardFrame kicker="Rohlík cart" title="Building the cart" live>
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

  const { items, total } = readCart(events[cartAt]);
  const count = items.reduce((s, i) => s + i.qty, 0);
  const landed = 100 + items.length * 80 + 350;
  // A cart that arrived long ago (card shown again later) just shows its total.
  const ts = events[cartAt].ts;
  const settled = typeof ts === "number" && Date.now() - ts > landed + 4000;

  return (
    <CardFrame
      kicker="Rohlík cart"
      title="Tonight's order"
      aside={`${items.length} products, ${count} pcs`}
      foot={
        <div className="ck-cart-foot">
          <p className="ck-cart-note">
            Rohlík delivers within the hour.
            <br />
            You confirm the order in Rohlík.
          </p>
          <Total to={total} delay={landed} settled={settled} />
        </div>
      }
    >
      <motion.ul className="ck-cart-list" variants={stagger} initial="hidden" animate="show">
        {items.map((it, i) => (
          <motion.li key={`${it.name}-${i}`} variants={rise} className="ck-cart-row">
            <Thumb src={it.image} name={it.name} />
            <span className="ck-cart-main">
              <span className="ck-cart-name">{it.name}</span>
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
      </motion.ul>
    </CardFrame>
  );
}
