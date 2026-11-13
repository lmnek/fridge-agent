import { useState } from "react";
import { ChartTooltip, columnPath, DataTable, useWidth } from "./chartKit";

const H = 150;
const TOP = 22;
const BOTTOM = 24;

const times = (n: number) => (n === 0 ? "ani jednou" : `otevřeno ${n}×`);

/** Kolikrát se dnes otevřela lednice v jednotlivých hodinách. */
export function DoorChart({ data }: { data: number[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const hours = data.length === 24 ? data : Array.from({ length: 24 }, (_, i) => data[i] ?? 0);
  const nowHour = new Date().getHours();
  const max = Math.max(...hours, 1);
  const peak = hours.indexOf(Math.max(...hours));
  const slot = width / 24;
  const barW = Math.max(3, Math.min(14, slot - 4));
  const plotH = H - TOP - BOTTOM;

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height: H }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label="Otevření lednice podle hodin dne">
            <line x1={0} x2={width} y1={H - BOTTOM + 0.5} y2={H - BOTTOM + 0.5} stroke="rgb(221 239 247 / 0.1)" />
            {hours.map((v, i) => {
              const cx = slot * i + slot / 2;
              const h = (v / max) * plotH;
              const y = H - BOTTOM - h;
              const isNow = i === nowHour;
              const active = hover === i;
              return (
                <g
                  key={i}
                  tabIndex={0}
                  role="button"
                  aria-label={`${i}:00 až ${i + 1}:00, ${times(v)}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                >
                  <rect x={slot * i} y={TOP - 8} width={slot} height={plotH + 8} fill="transparent" />
                  {v > 0 ? (
                    <path
                      d={columnPath(cx - barW / 2, y, barW, Math.max(h, 2), 3)}
                      fill={isNow ? "var(--color-glacier)" : "var(--color-sky)"}
                      opacity={isNow || active ? 1 : 0.5}
                    />
                  ) : (
                    <rect
                      x={cx - barW / 2}
                      y={H - BOTTOM - 2}
                      width={barW}
                      height={2}
                      rx={1}
                      fill={isNow ? "var(--color-glacier)" : "rgb(221 239 247 / 0.12)"}
                    />
                  )}
                  {i === peak && v > 0 && (
                    <text x={cx} y={y - 7} textAnchor="middle" className="tabular fill-frost text-[11px]">
                      {v}×
                    </text>
                  )}
                  {(isNow || (i % 6 === 0 && Math.abs(i - nowHour) >= 2)) && (
                    <text
                      x={cx}
                      y={H - 7}
                      textAnchor="middle"
                      className={isNow ? "fill-glacier text-[11px]" : "fill-mist text-[11px]"}
                    >
                      {isNow ? "teď" : `${i}:00`}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <ChartTooltip x={slot * hover + slot / 2} y={H - BOTTOM - (hours[hover] / max) * plotH}>
            <span className="tabular block font-medium">
              {hover}:00 až {hover + 1}:00
            </span>
            <span className="block text-mist">{times(hours[hover])}</span>
          </ChartTooltip>
        )}
      </div>
      <DataTable
        caption="Otevření lednice podle hodin"
        head={["Hodina", "Otevření"]}
        rows={hours.map((v, i) => [`${i}:00`, v]).filter((r) => (r[1] as number) > 0)}
      />
    </div>
  );
}
