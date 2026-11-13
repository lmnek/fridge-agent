import { api } from "../../lib/api";
import type { DealSearchResult } from "../../lib/types";
import { ChainBadge, DemoTag, Panel, SectionTitle, Skeleton } from "../../ui/bits";
import { cx, czk, distance } from "../../lib/format";
import { DiscountBadge } from "./DealCard";
import { ErrorLine, useAsync } from "./useAsync";

/** Co dochází a kde je to teď v akci. */
export function NeedsDeals({ onPick, active, refreshKey }: { onPick: (q: string) => void; active: string; refreshKey: string | number }) {
  const res = useAsync<DealSearchResult[]>(() => api.dealsForNeeds(), [refreshKey]);
  const rows = res.data ?? [];
  const savings = rows.reduce((sum, r) => {
    const b = r.best;
    return b && b.original_price_czk ? sum + Math.max(0, b.original_price_czk - b.price_czk) : sum;
  }, 0);
  const demo = rows.some((r) => r.deals.some((d) => d.source === "demo"));

  return (
    <Panel aria-labelledby="needs-deals">
      <SectionTitle id="needs-deals" aside={demo ? <DemoTag /> : undefined}>
        Co se vyplatí koupit
      </SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-mist">
        {rows.length
          ? `Věci, které ti dochází, a kde jsou teď nejlevněji.${savings > 0 ? ` Na akcích ušetříš ${czk(savings)}.` : ""}`
          : "Věci, které ti dochází, a kde jsou teď nejlevněji."}
      </p>
      {res.error && <ErrorLine message={res.error} onRetry={res.reload} />}
      {res.loading && !res.data && (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      )}
      {res.data && !rows.length && <p className="text-sm text-mist">Nic ti nedochází. Lednice je zásobená.</p>}
      {rows.length > 0 && (
        <ul className="-mx-2 divide-y divide-white/[0.05]">
          {rows.map((r) => {
            const b = r.best;
            const isActive = r.query.toLowerCase() === active.toLowerCase();
            return (
              <li key={r.query}>
                <button
                  type="button"
                  onClick={() => onPick(r.query)}
                  aria-pressed={isActive}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors",
                    isActive ? "bg-glacier/[0.07]" : "hover:bg-white/[0.03]",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] text-frost">{r.query}</span>
                    <span className="block truncate text-xs text-mist">
                      {b
                        ? `${b.nearest_store?.distance_m != null ? `${distance(b.nearest_store.distance_m)}, ` : ""}${r.deals.length} ${r.deals.length === 1 ? "nabídka" : r.deals.length < 5 ? "nabídky" : "nabídek"}`
                        : "teď bez akce"}
                    </span>
                  </span>
                  {b && (
                    <>
                      <ChainBadge chain={b.chain} className="max-sm:hidden" />
                      <span className="text-right">
                        <span className="display-tight tabular block text-lg leading-none font-semibold text-frost">{czk(b.price_czk)}</span>
                        <span className="mt-1 flex justify-end sm:hidden">
                          <ChainBadge chain={b.chain} className="h-5 px-1.5 text-[10px]" />
                        </span>
                      </span>
                      <DiscountBadge pct={b.discount_pct} className="max-sm:hidden" />
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
