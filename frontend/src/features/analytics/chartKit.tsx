import { useEffect, useRef, useState, type ReactNode } from "react";

/** Šířka kontejneru v px (grafy kreslíme ve skutečných pixelech, ať se text nedeformuje). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Sloupec se zaobleným koncem dat (4 px) a rovnou základnou. */
export function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h}`,
    "Z",
  ].join(" ");
}

/** Vodorovný pruh se zaobleným koncem vpravo a rovnou základnou vlevo. */
export function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (w <= 0) return "";
  const rr = Math.min(r, h / 2, w);
  return [
    `M${x},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h - rr}`,
    `Q${x + w},${y + h} ${x + w - rr},${y + h}`,
    `H${x}`,
    "Z",
  ].join(" ");
}

/** Bublina nad sloupcem při najetí nebo fokusu. */
export function ChartTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-white/10 bg-[#0d1e34]/95 px-3 py-2 text-xs whitespace-nowrap text-frost shadow-[0_12px_30px_-10px_rgb(0_0_0/0.7)] backdrop-blur"
      style={{ left: x, top: y - 10 }}
    >
      {children}
    </div>
  );
}

/** Tabulková podoba grafu (přístupnost, přesná čísla). */
export function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="group mt-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-lg text-xs text-haze hover:text-mist [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Zobrazit jako tabulku</span>
        <span className="hidden group-open:inline">Skrýt tabulku</span>
      </summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-white/[0.06]">
        <table className="w-full text-left text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-abyss text-xs text-mist">
            <tr>
              {head.map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/[0.05]">
                {r.map((c, j) => (
                  <td key={j} className="px-3 py-1.5 text-frost/90">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
