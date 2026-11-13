import { Bike, ExternalLink, Star } from "lucide-react";
import type { DeliveryVenue } from "../../lib/types";
import { chainStyle, venueProvider } from "../../lib/chains";
import { czk, distance } from "../../lib/format";

const PROVIDER_LABEL: Record<string, string> = { wolt: "Wolt", foodora: "foodora" };
const OPEN_IN: Record<string, string> = { wolt: "Otevřít ve Woltu", foodora: "Otevřít ve foodoře" };

export function VenueCard({ venue }: { venue: DeliveryVenue }) {
  const provider = venueProvider(venue.url, venue.provider);
  const style = chainStyle(provider);
  const label = PROVIDER_LABEL[provider] ?? provider;
  const name = venue.name.replace(/\s*\(demo\)\s*$/i, "");
  const body = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-display text-[17px] leading-snug font-semibold text-frost">{name}</span>
          {venue.cuisine.length > 0 && (
            <span className="mt-0.5 block truncate text-xs text-mist">{venue.cuisine.join(", ")}</span>
          )}
        </span>
        <span
          className="inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-bold"
          style={{ background: style.bg, color: style.fg }}
        >
          {label}
        </span>
      </span>
      <span className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-mist">
        {venue.rating !== null && (
          <span className="inline-flex items-center gap-1 text-frost">
            <Star className="size-3.5 fill-butter text-butter" aria-hidden />
            <span className="tabular">{venue.rating.toLocaleString("cs-CZ")}</span>
            <span className="sr-only">hodnocení</span>
          </span>
        )}
        {venue.delivery_minutes !== null && (
          <span className="inline-flex items-center gap-1">
            <Bike className="size-3.5" aria-hidden />
            {venue.delivery_minutes} min
          </span>
        )}
        {venue.delivery_fee_czk !== null && (
          <span>{venue.delivery_fee_czk === 0 ? "doprava zdarma" : `doprava ${czk(venue.delivery_fee_czk)}`}</span>
        )}
        {venue.distance_m !== null && <span>{distance(venue.distance_m)}</span>}
      </span>
      {venue.url && (
        <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-glacier group-hover:underline">
          {OPEN_IN[provider] ?? "Otevřít"}
          <ExternalLink className="size-3.5" aria-hidden />
        </span>
      )}
    </>
  );
  const cls =
    "frost-chip group block w-full rounded-[20px] p-3.5 text-left transition-colors hover:border-glacier/30 hover:bg-white/[0.07]";
  return venue.url ? (
    <a href={venue.url} target="_blank" rel="noreferrer" className={cls}>
      {body}
      <span className="sr-only"> (otevře se v novém okně)</span>
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}
