import { Route, ShoppingCart, Store as StoreIcon, Truck, type LucideIcon } from "lucide-react";
import { api } from "../../lib/api";
import type { PlanStrategy, ShoppingPlan } from "../../lib/types";
import { ChainBadge, Panel, SectionTitle, Skeleton } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { cx, czk, distance, plural } from "../../lib/format";
import { ErrorLine, useAsync } from "./useAsync";

const STRATEGY: Record<PlanStrategy, { label: string; icon: LucideIcon }> = {
  cheapest_split: { label: "Nejlevněji", icon: Route },
  single_store: { label: "Jeden obchod", icon: StoreIcon },
  online_delivery: { label: "Dovoz domů", icon: Truck },
};

function PlanCard({
  plan,
  best,
  maxTotal,
  active,
  onSelect,
  onFillCart,
  filling,
}: {
  plan: ShoppingPlan;
  best: boolean;
  maxTotal: number;
  active: boolean;
  onSelect: () => void;
  onFillCart: () => void;
  filling: boolean;
}) {
  const s = STRATEGY[plan.strategy];
  const Icon = s.icon;
  const online = plan.strategy === "online_delivery";
  const storeStops = plan.stops.filter((st) => st.kind === "store").length;
  return (
    <article
      className={cx(
        "relative flex min-w-[260px] flex-1 snap-start flex-col rounded-[22px] border p-4 transition-colors sm:p-5",
        active ? "border-glacier/55 bg-glacier/[0.06]" : "border-white/[0.07] bg-white/[0.025]",
      )}
    >
      <div className="flex items-center gap-2 text-sm text-mist">
        <Icon className={cx("size-4", best ? "text-glacier" : "text-haze")} aria-hidden />
        <span>{s.label}</span>
        {best && (
          <span className="ml-auto rounded-full bg-glacier px-2 py-0.5 text-[11px] font-semibold text-ink">vychází nejlíp</span>
        )}
      </div>
      <h3 className="mt-2 text-[17px] leading-snug font-semibold text-frost">{plan.title}</h3>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="display-tight tabular text-[40px] leading-none font-semibold text-frost">{czk(plan.total_czk, { whole: true })}</span>
        {plan.regular_total_czk > plan.total_czk && (
          <span className="tabular text-sm text-haze line-through">{czk(plan.regular_total_czk, { whole: true })}</span>
        )}
      </div>
      {/* délka pruhu = cena, kratší je levnější */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(8, (plan.total_czk / maxTotal) * 100)}%`,
            background: best ? "var(--color-glacier)" : online ? "var(--color-aurora)" : "var(--color-mist)",
            transition: "width .8s var(--ease-frost)",
          }}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-[11px] text-mist">ušetříš</dt>
          <dd className={cx("tabular font-medium", plan.savings_czk > 0 ? "text-glacier" : "text-frost")}>{czk(plan.savings_czk)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-mist">{online ? "cesta" : "trasa"}</dt>
          <dd className="tabular font-medium text-frost">
            {online || !plan.travel_m ? "bez cesty" : `${distance(plan.travel_m)}, ${storeStops} ${plural(storeStops, "obchod", "obchody", "obchodů")}`}
          </dd>
        </div>
      </dl>

      <ul className="mt-4 space-y-2.5 border-t border-white/[0.06] pt-3">
        {plan.stops.map((st, i) => (
          <li key={`${st.chain}-${i}`}>
            <div className="flex items-center gap-2">
              <ChainBadge chain={st.chain} className="h-5 px-1.5 text-[11px]" />
              {st.store?.distance_m != null && <span className="tabular text-xs text-mist">{distance(st.store.distance_m)}</span>}
              <span className="tabular ml-auto text-sm text-frost">{czk(st.subtotal_czk)}</span>
            </div>
            <p className="mt-1 text-xs leading-snug text-mist">{st.items.map((it) => it.query).join(", ")}</p>
          </li>
        ))}
      </ul>

      {plan.missing.length > 0 && (
        <p className="mt-3 text-xs text-butter">Tohle se nikde nenašlo: {plan.missing.join(", ")}</p>
      )}
      <p className="mt-3 text-xs leading-snug text-haze">{plan.explanation}</p>

      <div className="mt-auto pt-4">
        {online ? (
          <Button variant="glass" size="sm" icon={<ShoppingCart className="size-4" aria-hidden />} onClick={onFillCart} busy={filling} className="w-full">
            Naplnit košík v Rohlíku
          </Button>
        ) : (
          <Button variant={active ? "primary" : "glass"} size="sm" onClick={onSelect} aria-pressed={active} className="w-full">
            {active ? "Trasa je na radaru" : "Ukázat trasu na radaru"}
          </Button>
        )}
      </div>
    </article>
  );
}

export function PlanCompare({
  refreshKey,
  activeStrategy,
  onSelect,
  onFillCart,
  filling,
}: {
  refreshKey: string | number;
  activeStrategy: PlanStrategy | null;
  onSelect: (plan: ShoppingPlan | null) => void;
  onFillCart: () => void;
  filling: boolean;
}) {
  const res = useAsync<ShoppingPlan[]>(() => api.plan([]), [refreshKey]);
  const plans = res.data ?? [];
  const bestScore = Math.min(...plans.map((p) => p.score));
  const maxTotal = Math.max(1, ...plans.map((p) => p.total_czk));
  const items = plans[0] ? [...new Set(plans[0].stops.flatMap((s) => s.items.map((i) => i.query)))] : [];

  return (
    <Panel aria-labelledby="plan-compare">
      <SectionTitle id="plan-compare">Jak nakoupit, co dochází</SectionTitle>
      <p className="-mt-1 mb-4 text-sm text-mist">
        {items.length ? `Porovnání pro ${items.join(", ").toLowerCase()}. Počítá se cena, cesta i počet zastávek.` : "Frida porovná obchody, trasu i dovoz."}
      </p>
      {res.error && <ErrorLine message={res.error} onRetry={res.reload} />}
      {res.loading && !res.data && (
        <div className="flex gap-3">
          <Skeleton className="h-80 flex-1" />
          <Skeleton className="hidden h-80 flex-1 sm:block" />
          <Skeleton className="hidden h-80 flex-1 lg:block" />
        </div>
      )}
      {res.data && !plans.length && <p className="text-sm text-mist">Nic ti nedochází, takže není co plánovat.</p>}
      {plans.length > 0 && (
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {plans.map((p) => (
            <PlanCard
              key={p.strategy}
              plan={p}
              best={p.score === bestScore}
              maxTotal={maxTotal}
              active={p.strategy === activeStrategy}
              onSelect={() => onSelect(p.strategy === activeStrategy ? null : p)}
              onFillCart={onFillCart}
              filling={filling}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
