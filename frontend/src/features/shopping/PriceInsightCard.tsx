import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PriceInsight } from "../../lib/types";
import { cx, czk, dateShort } from "../../lib/format";

const VERDICT: Record<PriceInsight["verdict"], { label: string; cls: string; color: string }> = {
  buy_now: { label: "Kup teď", cls: "bg-glacier text-ink", color: "var(--color-glacier)" },
  good: { label: "Dobrá cena", cls: "bg-glacier/15 text-glacier", color: "var(--color-glacier)" },
  wait: { label: "Radši počkej", cls: "bg-butter/15 text-butter", color: "var(--color-butter)" },
  unknown: { label: "Málo dat", cls: "bg-white/[0.07] text-mist", color: "var(--color-mist)" },
};

interface Point {
  day: string;
  price: number;
}

/** Nejnižší cena napříč řetězci pro každý den. */
function dailyMin(history: PriceInsight["history"]): Point[] {
  const byDay = new Map<string, number>();
  for (const h of history) {
    const cur = byDay.get(h.day);
    if (cur === undefined || h.price_czk < cur) byDay.set(h.day, h.price_czk);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, price]) => ({ day, price }));
}

export function Sparkline({
  points,
  average,
  current,
  color,
  height = 84,
}: {
  points: Point[];
  average: number | null;
  current: number | null;
  color: string;
  height?: number;
}) {
  const gid = useId();
  // skutečná šířka v px, ať se text a body v SVG neroztahují
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const padY = 10;
  const series = current !== null ? [...points, { day: "dnes", price: current }] : points;
  if (series.length < 2) return <div ref={box} />;
  const prices = series.map((p) => p.price).concat(average ?? []);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => padY + (1 - (v - min) / span) * (H - padY * 2);
  const line = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const lowIdx = series.reduce((best, p, i) => (p.price < series[best].price ? i : best), 0);
  const last = series.length - 1;

  return (
    <div ref={box} className="w-full">
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block overflow-visible" role="img" aria-label="Vývoj nejnižší ceny za poslední 3 měsíce">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      {average !== null && (
        <g>
          <line x1={0} x2={W} y1={y(average)} y2={y(average)} stroke="rgb(221 239 247 / 0.25)" strokeDasharray="3 4" />
          <text x={4} y={y(average) - 4} fontSize="10" fill="rgb(147 172 192)">
            průměr {czk(average)}
          </text>
        </g>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(lowIdx)} cy={y(series[lowIdx].price)} r={3} fill="var(--color-ink)" stroke={color} strokeWidth={1.5} />
      <circle cx={x(last)} cy={y(series[last].price)} r={4.5} fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
    </svg>
    </div>
  );
}

export function PriceInsightCard({ insight, query }: { insight: PriceInsight; query: string }) {
  const v = VERDICT[insight.verdict];
  const points = useMemo(() => dailyMin(insight.history), [insight.history]);
  const first = points[0]?.day;
  return (
    <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.025] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx("inline-flex h-7 items-center rounded-full px-3 text-[13px] font-semibold", v.cls)}>{v.label}</span>
        <span className="text-sm text-mist">Cena za 3 měsíce: {query}</span>
      </div>
      <p className="mt-2.5 max-w-prose text-[15px] leading-snug text-frost">{insight.message}</p>
      <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-4">
        <div className="min-w-0">
          <Sparkline points={points} average={insight.average_90d} current={insight.current_best} color={v.color} />
          {first && (
            <div className="mt-1 flex justify-between text-[11px] text-haze">
              <span>{dateShort(first)}</span>
              <span>dnes</span>
            </div>
          )}
        </div>
        <dl className="grid gap-2 text-right">
          <div>
            <dt className="text-[11px] text-mist">teď nejlevněji</dt>
            <dd className="display-tight tabular text-xl leading-none font-semibold text-frost">{czk(insight.current_best)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-mist">minimum za 90 dní</dt>
            <dd className="tabular text-sm text-frost">{czk(insight.lowest_90d)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
