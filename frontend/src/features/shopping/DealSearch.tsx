import { useEffect, useId, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../../lib/api";
import type { Deal, DealSearchResult, PriceInsight } from "../../lib/types";
import { DemoTag, Empty, inputCls, Panel, SectionTitle, Skeleton } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { cx } from "../../lib/format";
import { DealCard } from "./DealCard";
import { PriceInsightCard } from "./PriceInsightCard";
import { ErrorLine, useAsync } from "./useAsync";

interface Result {
  search: DealSearchResult;
  insight: PriceInsight | null;
}

export function DealSearch({
  query,
  onQuery,
  suggestions,
  selectedId,
  onSelect,
}: {
  query: string;
  onQuery: (q: string) => void;
  suggestions: string[];
  selectedId: string | null;
  onSelect: (deal: Deal | null) => void;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);

  const res = useAsync<Result>(
    async () => {
      const [search, insight] = await Promise.all([api.deals(query), api.insight(query).catch(() => null)]);
      return { search, insight };
    },
    [query],
    query.trim().length > 0,
  );

  // po novém hledání vybrat nejlepší akci (kvůli radaru)
  useEffect(() => {
    const best = res.data?.search.best ?? null;
    onSelect(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.data]);

  const deals = res.data?.search.deals ?? [];
  const demo = deals.some((d) => d.source === "demo");

  return (
    <Panel aria-labelledby="deal-search">
      <SectionTitle id="deal-search" aside={demo ? <DemoTag /> : undefined}>
        Akce v okolí
      </SectionTitle>

      <form
        className="flex gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = draft.trim();
          if (q) onQuery(q);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Co hledáš
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-haze" aria-hidden />
          <input
            id={inputId}
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Máslo, mléko, kuřecí prsa…"
            className={cx(inputCls, "pl-10")}
            autoComplete="off"
          />
        </div>
        <Button type="submit" variant="primary" disabled={!draft.trim()}>
          Hledat
        </Button>
      </form>

      {suggestions.length > 0 && (
        <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onQuery(s)}
              aria-pressed={s.toLowerCase() === query.toLowerCase()}
              className={cx(
                "h-8 shrink-0 rounded-full px-3 text-[13px] transition-colors",
                s.toLowerCase() === query.toLowerCase() ? "bg-frost text-ink" : "frost-chip text-mist hover:text-frost",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-4" aria-live="polite" aria-busy={res.loading}>
        {res.error && <ErrorLine message={res.error} onRetry={res.reload} />}
        {res.loading && !res.data && (
          <>
            <Skeleton className="h-44" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          </>
        )}
        {res.data && (
          <div className={cx("space-y-4 transition-opacity", res.loading && "opacity-50")}>
            {res.data.insight && <PriceInsightCard insight={res.data.insight} query={res.data.search.query} />}
            {res.data.search.note && <p className="text-sm text-mist">{res.data.search.note}</p>}
            {deals.length ? (
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {deals.map((d) => (
                  <DealCard
                    key={d.id}
                    deal={d}
                    best={d.id === res.data?.search.best?.id}
                    active={d.id === selectedId}
                    onSelect={(deal) => onSelect(deal.id === selectedId ? null : deal)}
                  />
                ))}
              </div>
            ) : (
              <Empty title="Teď to nikde v akci není">
                Zkus to za pár dní, nebo hledej obecněji (třeba jen „sýr“).
              </Empty>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
