// C3 where to buy: a radar of the nearby shops against Rohlík delivery, and the scraped price grid.
// Everything comes from the `deals` event; the sweep runs while the deals tool is still working.
import { motion } from "motion/react";
import type { BusEvent } from "../bus";
import { CardFrame, Tag, all, latest, rise, stagger } from "./ui";
import "./ShopsCard.css";

type Deal = { item: string; store: string; price_czk: number; was_czk: number | null };
type Store = { name: string; distance_m: number | null; delivery_min?: number };

const DELIVERY = "Rohlík";
const WALK_M_PER_MIN = 80;
const SIZE = 320;
const C = SIZE / 2;
const R = 142;
// HACK(demo): fixed bearings so the blips land in calm, readable spots (we have no coordinates, only distances).
const BEARINGS = [-50, 205, 120, 20, 290];

function isDelivery(s: Store) {
  return s.distance_m == null;
}

function num(n: number) {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

function ago(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return min <= 1 ? "Scraped just now" : `Scraped ${min} min ago`;
  return `Scraped ${Math.round(min / 60)} h ago`;
}

function dist(m: number) {
  return m < 1000 ? `${m} m` : `${num(Math.round(m / 100) / 10)} km`;
}

function polar(deg: number, r: number) {
  const a = (deg * Math.PI) / 180;
  return { x: C + Math.sin(a) * r, y: C - Math.cos(a) * r };
}

function wedge(from: number, to: number) {
  const a = polar(from, R);
  const b = polar(to, R);
  return `M${C},${C} L${a.x},${a.y} A${R},${R} 0 0 1 ${b.x},${b.y} Z`;
}

function Radar({ stores, scanning }: { stores: Store[]; scanning: boolean }) {
  const shops = stores.filter((s) => !isDelivery(s));
  const far = Math.max(400, ...shops.map((s) => s.distance_m ?? 0));
  const range = Math.ceil((far * 1.25) / 250) * 250;
  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <svg className="ck-shops-radar" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
      <circle cx={C} cy={C} r={R} className="ck-shops-disc" />
      {rings.map((k) => (
        <circle key={k} cx={C} cy={C} r={R * k} className="ck-shops-ring" />
      ))}
      <line x1={C - R} y1={C} x2={C + R} y2={C} className="ck-shops-ring" />
      <line x1={C} y1={C - R} x2={C} y2={C + R} className="ck-shops-ring" />
      <text x={C + 6} y={C - R * 0.5 - 8} className="ck-shops-scale">
        {dist(range / 2)}
      </text>
      <text x={C + 6} y={C - R + 24} className="ck-shops-scale">
        {dist(range)}
      </text>

      {/* The sweep: a leading line with a trail of flat slices that step down in opacity. */}
      <motion.g initial={false} animate={{ opacity: scanning ? 1 : 0 }} transition={{ duration: 0.8 }}>
        <g className="ck-shops-sweep">
          {[0.16, 0.1, 0.06, 0.03].map((o, i) => (
            <path key={o} d={wedge(-(i + 1) * 12, -i * 12)} fill="var(--ck-lamp)" opacity={o} />
          ))}
          <line x1={C} y1={C} x2={C} y2={C - R} stroke="var(--ck-lamp)" strokeWidth={2} />
        </g>
      </motion.g>

      {!scanning &&
        shops.map((s, i) => {
          const p = polar(BEARINGS[i % BEARINGS.length], ((s.distance_m ?? 0) / range) * R);
          const below = p.y > C;
          return (
            <motion.g
              key={s.name}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.15 + i * 0.25 }}
              style={{ transformOrigin: `${p.x}px ${p.y}px` }}
            >
              <circle cx={p.x} cy={p.y} r={9} className="ck-shops-blip" />
              <text x={p.x} y={below ? p.y + 34 : p.y - 18} textAnchor="middle" className="ck-shops-blip-name">
                {s.name}
              </text>
            </motion.g>
          );
        })}

      {/* Home sits at the centre; the delivery store comes to it, drawn as the blue ring around home. */}
      {!scanning && (
        <motion.circle
          cx={C}
          cy={C}
          className="ck-shops-door"
          initial={{ r: 4, opacity: 0 }}
          animate={{ r: 24, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 16, delay: 0.8 }}
        />
      )}
      <circle cx={C} cy={C} r={8} className="ck-shops-home" />
    </svg>
  );
}

export default function ShopsCard({ events }: { events: BusEvent[] }) {
  const ev = latest(events, "deals");
  const started = all(events, "tool", (e) => e.name === "get_deals" || e.name === "show_shops");

  const deals: Deal[] = ev?.items ?? [];
  const raw: Store[] = ev?.stores ?? [
    { name: DELIVERY, distance_m: null, delivery_min: 60 },
    { name: "Lidl", distance_m: 400 },
    { name: "Albert", distance_m: 700 },
  ];
  // Delivery store first, then shops nearest first.
  const stores = [...raw].sort((a, b) => (isDelivery(a) ? -1 : isDelivery(b) ? 1 : (a.distance_m ?? 0) - (b.distance_m ?? 0)));
  const winner = stores.find(isDelivery) ?? stores[0];
  // While the tool runs, the rows come from its args so the grid is already in place when prices land.
  const asked: string[] = started.find((e) => Array.isArray(e.args?.items))?.args.items ?? [];
  const items = ev ? [...new Set(deals.map((d) => d.item))] : asked;
  const price = (item: string, store: string) => deals.find((d) => d.item === item && d.store === store);
  const has = (store: string) => items.filter((i) => price(i, store)).length;

  const verdict = (s: Store) =>
    isDelivery(s)
      ? `At your door within ${s.delivery_min && s.delivery_min !== 60 ? `${s.delivery_min} min` : "the hour"}`
      : `${dist(s.distance_m ?? 0)}, a ${Math.max(1, Math.round((s.distance_m ?? 0) / WALK_M_PER_MIN))}-minute walk each way`;

  // The grid only picks a side once the prices are in.
  const win = ev ? winner : null;
  const cols = { gridTemplateColumns: `1fr repeat(${stores.length}, 172px)` };

  return (
    <CardFrame
      kicker="Where to buy"
      live={!ev}
      title={ev ? `${winner.name}, within ${winner.delivery_min && winner.delivery_min !== 60 ? `${winner.delivery_min} min` : "the hour"}` : "Checking prices nearby"}
      aside={ev?.scraped_at ? ago(ev.scraped_at) : undefined}
    >
      <div className="ck-shops-top">
        <Radar stores={stores} scanning={!ev} />
        <motion.ul className="ck-shops-verdict" variants={stagger} initial="hidden" animate={ev ? "show" : "hidden"}>
          {stores.map((s) => (
            <motion.li key={s.name} variants={rise} className={s === winner ? "is-win" : ""}>
              <span className={`ck-shops-key${isDelivery(s) ? " is-door" : ""}`} />
              <div>
                <strong>{s.name}</strong>
                <p>{verdict(s)}</p>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      </div>

      {items.length > 0 && (
        <motion.div className="ck-shops-grid" variants={stagger} initial="hidden" animate="show">
          <div className="ck-shops-row is-head" style={cols}>
            <span>Price in Kč</span>
            {stores.map((s) => (
              <span key={s.name} className={s === win ? "is-win" : ""}>
                {s.name}
              </span>
            ))}
          </div>
          {items.map((item) => (
            <motion.div key={item} variants={rise} className="ck-shops-row" style={cols}>
              <span className="ck-shops-item">{item}</span>
              {stores.map((s) => {
                const d = price(item, s.name);
                const off = d?.was_czk ? Math.round(((d.was_czk - d.price_czk) / d.was_czk) * 100) : 0;
                return (
                  <span key={s.name} className={`ck-shops-cell${s === win ? " is-win" : ""}`}>
                    {!ev ? null : !d ? (
                      <span className="ck-shops-none">–</span>
                    ) : (
                      <>
                        {off > 0 && s === win && <s>{num(d.was_czk!)}</s>}
                        <b>{num(d.price_czk)}</b>
                        {off > 0 && <Tag tone="soon">−{off} %</Tag>}
                      </>
                    )}
                  </span>
                );
              })}
            </motion.div>
          ))}
          {ev && (
          <motion.div variants={rise} className="ck-shops-row is-foot" style={cols}>
            <span>In stock</span>
            {stores.map((s) => (
              <span key={s.name} className={`ck-shops-cell${s === win ? " is-win" : ""}`}>
                {has(s.name) === items.length ? `All ${items.length}` : <em>{`${has(s.name)} of ${items.length}`}</em>}
              </span>
            ))}
          </motion.div>
          )}
        </motion.div>
      )}
    </CardFrame>
  );
}
