import { CreditCard, MapPin } from "lucide-react";
import type { Deal } from "../../lib/types";
import { ChainBadge } from "../../ui/bits";
import { cx, czk, dateShort, distance } from "../../lib/format";

const UNIT: Record<string, string> = { kg: "kg", l: "l", ks: "ks" };

export function DiscountBadge({ pct, className }: { pct: number | null; className?: string }) {
  if (!pct) return null;
  return (
    <span
      className={cx(
        "tabular inline-flex h-6 items-center rounded-full bg-apricot px-2 text-xs font-semibold text-ink",
        className,
      )}
    >
      −{pct} %
    </span>
  );
}

export function DealCard({
  deal,
  best,
  active,
  onSelect,
}: {
  deal: Deal;
  best?: boolean;
  active?: boolean;
  onSelect?: (deal: Deal) => void;
}) {
  const store = deal.nearest_store;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(deal)}
      aria-pressed={active}
      className={cx(
        "group relative flex w-full flex-col rounded-[20px] border p-4 text-left transition-colors",
        active
          ? "border-glacier/50 bg-glacier/[0.07]"
          : "border-white/[0.07] bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.045]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <ChainBadge chain={deal.chain} />
        <div className="flex items-center gap-1.5">
          {best && <span className="text-xs font-medium text-glacier">nejlevněji</span>}
          <DiscountBadge pct={deal.discount_pct} />
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-[14.5px] leading-snug text-frost">{deal.product_name}</p>

      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="display-tight tabular text-[30px] leading-none font-semibold text-frost">{czk(deal.price_czk)}</span>
        {deal.original_price_czk && deal.original_price_czk > deal.price_czk && (
          <span className="tabular text-sm text-haze line-through">{czk(deal.original_price_czk)}</span>
        )}
      </div>
      {deal.unit_price && deal.unit_price_unit && (
        <p className="tabular mt-1 text-xs text-mist">
          {czk(deal.unit_price)} za {UNIT[deal.unit_price_unit] ?? deal.unit_price_unit}
          {deal.package ? `, balení ${deal.package}` : ""}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mist">
        {deal.valid_to && <span>platí do {dateShort(deal.valid_to)}</span>}
        {deal.requires_card && (
          <span className="inline-flex items-center gap-1 text-butter">
            <CreditCard className="size-3.5" aria-hidden />
            jen s kartou
          </span>
        )}
      </div>
      {store && (
        <p className="mt-2 flex items-center gap-1.5 border-t border-white/[0.06] pt-2 text-xs text-mist">
          <MapPin className="size-3.5 shrink-0 text-haze" aria-hidden />
          <span className="truncate">{store.name}</span>
          {store.distance_m !== null && <span className="tabular ml-auto shrink-0 text-frost">{distance(store.distance_m)}</span>}
        </p>
      )}
    </button>
  );
}
