import { useState } from "react";
import type { WasteMonth } from "../../lib/types";
import { czk, monthShort, plural } from "../../lib/format";
import { ChartTooltip, columnPath, DataTable, useWidth } from "./chartKit";

const H = 190;
const TOP = 26; // místo na popisek nad sloupcem
const BOTTOM = 26; // místo na měsíce

function itemsLabel(n: number) {
  return `${n} ${plural(n, "věc", "věci", "věcí")}`;
}

/** Kolik peněz skončilo v koši, po měsících. */
export function WasteChart({ data }: { data: WasteMonth[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="py-6 text-sm text-mist">Zatím se nic nevyhodilo. Tak to drž.</p>;

  const max = Math.max(...data.map((d) => d.czk), 1);
  const slot = width / data.length;
  const barW = Math.min(24, slot * 0.5);
  const plotH = H - TOP - BOTTOM;
  const labelAll = data.length <= 8;
  const maxIdx = data.findIndex((d) => d.czk === max);
  const last = data.length - 1;

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height: H }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label="Vyhozené potraviny po měsících v korunách">
            <line x1={0} x2={width} y1={H - BOTTOM + 0.5} y2={H - BOTTOM + 0.5} stroke="rgb(221 239 247 / 0.1)" />
            {data.map((d, i) => {
              const h = (d.czk / max) * plotH;
              const cx = slot * i + slot / 2;
              const x = cx - barW / 2;
              const y = H - BOTTOM - h;
              const active = hover === i;
              const current = i === last;
              const showLabel = labelAll || i === maxIdx || i === last;
              return (
                <g
                  key={d.month}
                  tabIndex={0}
                  role="button"
                  aria-label={`${monthShort(d.month)}: ${czk(d.czk)}, ${itemsLabel(d.items)}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                >
                  {/* větší neviditelná plocha pro najetí myší */}
                  <rect x={slot * i} y={TOP - 10} width={slot} height={plotH + 10} fill="transparent" />
                  <path
                    d={columnPath(x, y, barW, Math.max(h, 1.5))}
                    fill="var(--color-apricot)"
                    opacity={active || current ? 1 : 0.55}
                    style={{ transition: "opacity .2s" }}
                  />
                  {showLabel && (
                    <text x={cx} y={y - 8} textAnchor="middle" className="tabular fill-frost text-[11.5px]">
                      {czk(d.czk, { whole: true })}
                    </text>
                  )}
                  <text x={cx} y={H - 8} textAnchor="middle" className="fill-mist text-[11.5px]">
                    {monthShort(d.month)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <ChartTooltip x={slot * hover + slot / 2} y={H - BOTTOM - (data[hover].czk / max) * plotH}>
            <span className="block font-medium">{monthShort(data[hover].month)}</span>
            <span className="tabular block text-mist">
              {czk(data[hover].czk)}, {itemsLabel(data[hover].items)}
            </span>
          </ChartTooltip>
        )}
      </div>
      <DataTable
        caption="Vyhozeno po měsících"
        head={["Měsíc", "Kč", "Položek"]}
        rows={data.map((d) => [monthShort(d.month), czk(d.czk), d.items])}
      />
    </div>
  );
}
