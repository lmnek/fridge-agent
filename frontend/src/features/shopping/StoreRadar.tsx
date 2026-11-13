import { useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Clock, MapPin } from "lucide-react";
import type { GeoPoint, Store } from "../../lib/types";
import { chainStyle } from "../../lib/chains";
import { cx, distance, num } from "../../lib/format";

export interface RadarFocus {
  /** obchody, které se mají rozsvítit (vybraná akce, plán) */
  storeIds: string[];
  /** zastávky trasy v pořadí (plán nákupu) */
  route: Store[] | null;
  label: string | null;
}

const SIZE = 340;
const C = SIZE / 2;
const R = 148;

interface Placed {
  store: Store;
  x: number;
  y: number;
  dist: number;
}

/** Poloha obchodu vůči domovu v metrech (x na východ, y na sever). */
function offset(home: GeoPoint, s: Store): { dx: number; dy: number } {
  const lat = (home.lat * Math.PI) / 180;
  return {
    dx: (s.lon - home.lon) * 111_320 * Math.cos(lat),
    dy: (s.lat - home.lat) * 110_574,
  };
}

function ringStep(max: number): number {
  if (max <= 1200) return 250;
  if (max <= 2800) return 500;
  if (max <= 6000) return 1000;
  return 2000;
}

function kmLabel(m: number): string {
  return m < 1000 ? `${m} m` : `${num(m / 1000)} km`;
}

/** Stylizovaný radar obchodů kolem domova (bez mapových podkladů, funguje i offline). */
export function StoreRadar({
  home,
  stores,
  focus,
  className,
}: {
  home: GeoPoint;
  stores: Store[];
  focus: RadarFocus;
  className?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const reduce = useReducedMotion();

  const { placed, range, step } = useMemo(() => {
    const raw = stores.map((s) => {
      const { dx, dy } = offset(home, s);
      const computed = Math.hypot(dx, dy) || 1;
      const dist = s.distance_m ?? computed;
      return { store: s, dx, dy, computed, dist };
    });
    const maxDist = Math.max(400, ...raw.map((r) => r.dist));
    const st = ringStep(maxDist);
    const rng = Math.ceil((maxDist * 1.06) / st) * st;
    const pl: Placed[] = raw.map((r) => {
      const k = (r.dist / rng) * R;
      return { store: r.store, dist: r.dist, x: C + (r.dx / r.computed) * k, y: C - (r.dy / r.computed) * k };
    });
    return { placed: pl, range: rng, step: st };
  }, [home, stores]);

  const byId = useMemo(() => new Map(placed.map((p) => [p.store.id, p])), [placed]);
  const highlighted = new Set(focus.storeIds);
  const rings = Array.from({ length: Math.round(range / step) }, (_, i) => (i + 1) * step);
  const routePts = (focus.route ?? []).map((s) => byId.get(s.id)).filter(Boolean) as Placed[];
  const routePath = routePts.length
    ? `M${C},${C} ${routePts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} L${C},${C}`
    : null;

  const active =
    (activeId && byId.get(activeId)) ||
    (focus.storeIds.length ? byId.get(focus.storeIds[0]) : undefined) ||
    null;
  const chains = [...new Set(stores.map((s) => s.chain))];

  return (
    <div className={className}>
      <div className="relative mx-auto aspect-square w-full max-w-[400px]">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full overflow-visible" role="group" aria-label="Radar obchodů v okolí domova">
          <defs>
            <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#6ef0d8" stopOpacity="0.10" />
              <stop offset="0.7" stopColor="#5aa9ff" stopOpacity="0.04" />
              <stop offset="1" stopColor="#5aa9ff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={C} cy={C} r={R} fill="url(#radar-bg)" />

          {/* soustředné kruhy po krocích vzdálenosti */}
          {rings.map((m, i) => {
            const r = (m / range) * R;
            const last = i === rings.length - 1;
            return (
              <g key={m}>
                <circle cx={C} cy={C} r={r} fill="none" stroke={`rgb(221 239 247 / ${last ? 0.16 : 0.08})`} strokeDasharray={last ? undefined : "2 4"} />
                <text x={C + r * Math.cos(-0.5) + 3} y={C + r * Math.sin(-0.5) - 2} fontSize="9.5" fill="rgb(147 172 192)">
                  {kmLabel(m)}
                </text>
              </g>
            );
          })}
          <line x1={C} x2={C} y1={C - R} y2={C + R} stroke="rgb(221 239 247 / 0.05)" />
          <line x1={C - R} x2={C + R} y1={C} y2={C} stroke="rgb(221 239 247 / 0.05)" />
          <text x={C} y={C - R - 6} fontSize="10" textAnchor="middle" fill="rgb(147 172 192)">
            S
          </text>

          {/* paprsek, který objíždí okolí */}
          <g className="animate-[spin_7s_linear_infinite]" style={{ transformOrigin: `${C}px ${C}px` }} aria-hidden>
            {Array.from({ length: 14 }, (_, i) => {
              const a0 = (-90 - i * 4) * (Math.PI / 180);
              const a1 = (-90 - (i + 1) * 4) * (Math.PI / 180);
              return (
                <path
                  key={i}
                  d={`M${C},${C} L${C + Math.cos(a0) * R},${C + Math.sin(a0) * R} A${R},${R} 0 0 0 ${C + Math.cos(a1) * R},${C + Math.sin(a1) * R} Z`}
                  fill="#6ef0d8"
                  opacity={0.16 * (1 - i / 14)}
                />
              );
            })}
            <line x1={C} y1={C} x2={C} y2={C - R} stroke="#6ef0d8" strokeOpacity="0.55" strokeWidth="1.2" />
          </g>

          {/* trasa plánu */}
          {routePath && (
            <path
              d={routePath}
              fill="none"
              stroke="#6ef0d8"
              strokeWidth="1.6"
              strokeDasharray="5 5"
              strokeLinejoin="round"
              style={{ filter: "drop-shadow(0 0 4px rgb(110 240 216 / 0.6))" }}
            >
              {!reduce && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1.2s" repeatCount="indefinite" />}
            </path>
          )}

          {/* domov */}
          <circle cx={C} cy={C} r={14} fill="none" stroke="#6ef0d8" strokeOpacity="0.35" className="animate-ping" style={{ transformOrigin: `${C}px ${C}px` }} />
          <circle cx={C} cy={C} r={5.5} fill="#ddeff7" stroke="#07111f" strokeWidth="2" />

          {/* obchody */}
          {placed.map((p) => {
            const st = chainStyle(p.store.chain);
            const hi = highlighted.has(p.store.id);
            const isActive = active?.store.id === p.store.id;
            const closed = p.store.open_now === false;
            const label = `${p.store.name}, ${distance(p.dist)}${closed ? ", teď zavřeno" : ""}`;
            return (
              <g
                key={p.store.id}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={isActive}
                onMouseEnter={() => setActiveId(p.store.id)}
                onFocus={() => setActiveId(p.store.id)}
                onClick={() => setActiveId(p.store.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setActiveId(p.store.id);
                }}
                className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-frost"
              >
                <circle cx={p.x} cy={p.y} r={14} fill="transparent" stroke={isActive ? "rgb(221 239 247 / 0.5)" : "transparent"} />
                {hi && (
                  <circle cx={p.x} cy={p.y} r={10} fill="none" stroke={st.dot} strokeOpacity="0.7">
                    {!reduce && <animate attributeName="r" values="7;13;7" dur="2s" repeatCount="indefinite" />}
                    {!reduce && <animate attributeName="stroke-opacity" values="0.8;0;0.8" dur="2s" repeatCount="indefinite" />}
                  </circle>
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={hi || isActive ? 6.5 : 4.5}
                  fill={closed ? "#07111f" : st.dot}
                  stroke={st.dot}
                  strokeWidth={closed ? 1.5 : 0}
                  opacity={highlighted.size && !hi && !isActive ? 0.45 : 1}
                  style={{ filter: hi ? `drop-shadow(0 0 6px ${st.dot})` : undefined, transition: "r .3s, opacity .3s" }}
                />
                {(hi || isActive) && (
                  <text
                    x={p.x + (p.x > C + 60 ? -10 : 10)}
                    y={p.y + 4}
                    fontSize="11"
                    fontWeight="600"
                    textAnchor={p.x > C + 60 ? "end" : "start"}
                    fill="#ddeff7"
                    style={{ paintOrder: "stroke", stroke: "#07111f", strokeWidth: 3 }}
                  >
                    {p.store.chain}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* detail obchodu */}
      <div className="mt-3 min-h-[68px] rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3" aria-live="polite">
        {active ? (
          <div className="flex items-start gap-3">
            <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: chainStyle(active.store.chain).dot }} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-frost">{active.store.name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-mist">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {distance(active.dist)} od domova
                </span>
                {active.store.open_now !== null && (
                  <span className={cx("inline-flex items-center gap-1", active.store.open_now ? "text-glacier" : "text-apricot")}>
                    <Clock className="size-3.5" aria-hidden />
                    {active.store.open_now ? "teď otevřeno" : "teď zavřeno"}
                  </span>
                )}
                {active.store.opening_hours && <span>{active.store.opening_hours}</span>}
              </p>
              {focus.label && highlighted.has(active.store.id) && <p className="mt-1 text-xs text-glacier">{focus.label}</p>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-mist">Najeď nebo klepni na tečku a uvidíš, co je to za obchod.</p>
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Řetězce na radaru">
        {chains.map((ch) => (
          <li key={ch} className="inline-flex items-center gap-1.5 text-xs text-mist">
            <span className="size-2 rounded-full" style={{ background: chainStyle(ch).dot }} aria-hidden />
            {ch}
          </li>
        ))}
      </ul>
    </div>
  );
}
