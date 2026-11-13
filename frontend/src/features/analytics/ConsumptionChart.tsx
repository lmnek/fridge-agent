import type { ConsumptionStat, Unit } from "../../lib/types";
import { dateShort, num } from "../../lib/format";
import { DataTable } from "./chartKit";

const UNIT_GROUP: Record<Unit, string> = {
  ks: "Na kusy",
  l: "Na litry",
  ml: "Na mililitry",
  bal: "Na balení",
  g: "Na gramy",
  kg: "Na kila",
};
const UNIT_SHORT: Record<Unit, string> = { ks: "ks", l: "l", ml: "ml", bal: "bal.", g: "g", kg: "kg" };
const ORDER: Unit[] = ["ks", "bal", "l", "ml", "kg", "g"];

const BAR_H = 10;

function Row({ c, max }: { c: ConsumptionStat; max: number }) {
  const frac = max > 0 ? c.per_week / max : 0;
  return (
    <li className="grid grid-cols-[minmax(0,9.5rem)_1fr_auto] items-center gap-3 py-1.5 sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-[17px]" aria-hidden>
          {c.emoji}
        </span>
        <span className="truncate text-sm text-frost">{c.name}</span>
      </span>
      <span className="relative block w-full bg-white/[0.04]" style={{ height: BAR_H }} aria-hidden>
        <span
          className="absolute inset-y-0 left-0 rounded-r-[4px] bg-glacier/85"
          style={{ width: `${Math.max(1.5, frac * 100)}%`, transition: "width .7s var(--ease-frost)" }}
        />
      </span>
      <span className="text-right">
        <span className="tabular block text-sm text-frost">
          {num(c.per_week)} {UNIT_SHORT[c.unit]}
          <span className="text-mist"> za týden</span>
        </span>
        {c.predicted_out_on && (
          <span className="tabular block text-xs text-mist">dojde ~ {dateShort(c.predicted_out_on)}</span>
        )}
      </span>
    </li>
  );
}

/**
 * Spotřeba za týden. Jednotky se nedají srovnávat mezi sebou (kusy vs. litry),
 * proto má každá jednotka vlastní skupinu s vlastním měřítkem.
 */
export function ConsumptionChart({ data }: { data: ConsumptionStat[] }) {
  const groups = ORDER.map((u) => ({ unit: u, items: data.filter((c) => c.unit === u).sort((a, b) => b.per_week - a.per_week) })).filter(
    (g) => g.items.length,
  );
  if (!data.length) return <p className="py-6 text-sm text-mist">Spotřebu začnu počítat, až se v lednici něco pohne.</p>;
  return (
    <div>
      <div className="space-y-5">
        {groups.map((g) => {
          const max = Math.max(...g.items.map((i) => i.per_week));
          return (
            <div key={g.unit}>
              {groups.length > 1 && <h3 className="mb-1 text-xs text-haze">{UNIT_GROUP[g.unit]}</h3>}
              <ul>
                {g.items.map((c) => (
                  <Row key={c.canonical} c={c} max={max} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <DataTable
        caption="Spotřeba za týden"
        head={["Potravina", "Za týden", "Dojde"]}
        rows={data.map((c) => [c.name, `${num(c.per_week)} ${UNIT_SHORT[c.unit]}`, c.predicted_out_on ? dateShort(c.predicted_out_on) : "–"])}
      />
    </div>
  );
}
