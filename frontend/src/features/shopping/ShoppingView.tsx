import { useEffect, useMemo, useState } from "react";
import { Route } from "lucide-react";
import { PageHeader } from "../../components/shell/PageHeader";
import { api } from "../../lib/api";
import type { Deal, GeoPoint, ShoppingPlan, Store, UserPreferences } from "../../lib/types";
import { useApp } from "../../store/app";
import { Panel, SectionTitle, Skeleton } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { czk } from "../../lib/format";
import { askFrida } from "../chat/voiceTurn";
import { CartPanel, useFillNeeds } from "./CartPanel";
import { DealSearch } from "./DealSearch";
import { NeedsDeals } from "./NeedsDeals";
import { PlanCompare } from "./PlanCompare";
import { StoreRadar, type RadarFocus } from "./StoreRadar";
import { ErrorLine, useAsync } from "./useAsync";

const FALLBACK_QUERY = "máslo";

function RadarPanel({ focus, extraStores }: { focus: RadarFocus; extraStores: Store[] }) {
  const res = useAsync<{ stores: Store[]; prefs: UserPreferences }>(
    async () => {
      const [stores, prefs] = await Promise.all([api.stores(), api.prefs()]);
      return { stores, prefs };
    },
    [],
  );
  const home: GeoPoint | null = res.data?.prefs.location ?? null;
  const stores = useMemo(() => {
    const list = res.data?.stores ?? [];
    const ids = new Set(list.map((s) => s.id));
    return [...list, ...extraStores.filter((s) => !ids.has(s.id))];
  }, [res.data, extraStores]);

  return (
    <Panel aria-labelledby="store-radar">
      <SectionTitle id="store-radar">Obchody kolem tebe</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-mist">
        {home?.label ? `Kolem domova (${home.label}), podle vzdálenosti a směru.` : "Podle vzdálenosti a směru od domova."}
      </p>
      {res.error && <ErrorLine message={res.error} onRetry={res.reload} />}
      {res.loading && !res.data && <Skeleton className="mx-auto aspect-square w-full max-w-[400px] rounded-full" />}
      {home && <StoreRadar home={home} stores={stores} focus={focus} />}
    </Panel>
  );
}

export function ShoppingView() {
  const [query, setQuery] = useState<string>("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [plan, setPlan] = useState<ShoppingPlan | null>(null);
  const { fill, filling } = useFillNeeds();
  // když se změní, co dochází, přepočítat akce i plán
  const needsKey = useApp((s) => `${s.summary?.low ?? 0}-${s.summary?.out ?? 0}-${s.summary?.total_items ?? 0}`);
  const refreshKey = useMemo(() => needsKey, [needsKey]);

  // výchozí hledání: první věc, která dochází. Inventář už v klientu je, tak se hledá hned
  // a seznam potřeb ze serveru jen doplní návrhy.
  useEffect(() => {
    let alive = true;
    const local = useApp.getState().items.filter((i) => i.status === "out" || i.status === "low");
    if (local.length) setQuery((q) => q || local[0].name);
    api
      .needs()
      .then((needs) => {
        if (!alive) return;
        const names = [...new Set(needs.map((n) => n.name))];
        setSuggestions([...names.slice(0, 5), ...["máslo", "kuřecí prsa", "vejce"].filter((x) => !names.includes(x))].slice(0, 7));
        setQuery((q) => q || names[0] || FALLBACK_QUERY);
      })
      .catch(() => {
        if (!alive) return;
        setSuggestions(["máslo", "mléko", "kuřecí prsa", "vejce"]);
        setQuery((q) => q || FALLBACK_QUERY);
      });
    return () => {
      alive = false;
    };
  }, []);

  const focus: RadarFocus = useMemo(() => {
    if (plan) {
      const route = plan.stops.map((s) => s.store).filter(Boolean) as Store[];
      return { storeIds: route.map((s) => s.id), route, label: plan.title };
    }
    if (deal?.nearest_store) {
      return {
        storeIds: [deal.nearest_store.id],
        route: null,
        label: `${deal.product_name} za ${czk(deal.price_czk)}`,
      };
    }
    return { storeIds: [], route: null, label: null };
  }, [plan, deal]);

  const extraStores = useMemo(() => {
    const list: Store[] = [];
    if (deal?.nearest_store) list.push(deal.nearest_store);
    for (const st of plan?.stops ?? []) if (st.store) list.push(st.store);
    return list;
  }, [deal, plan]);

  return (
    <div className="pb-8">
      <PageHeader
        title="Nákup"
        lead="Akce v okolí, nejvýhodnější cesta po obchodech a košík v Rohlíku."
        actions={
          <Button variant="glass" icon={<Route className="size-4 text-glacier" aria-hidden />} onClick={() => void askFrida("Naplánuj nákup")}>
            Naplánuj se mnou
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,390px)] xl:gap-6">
        <div className="grid min-w-0 grid-cols-1 content-start gap-5 xl:gap-6">
          {query ? (
            <DealSearch
              query={query}
              onQuery={(q) => {
                setPlan(null);
                setQuery(q);
              }}
              suggestions={suggestions}
              selectedId={deal?.id ?? null}
              onSelect={(d) => {
                setDeal(d);
                if (d) setPlan(null);
              }}
            />
          ) : (
            <Skeleton className="h-96" />
          )}
          <PlanCompare
            refreshKey={refreshKey}
            activeStrategy={plan?.strategy ?? null}
            onSelect={setPlan}
            onFillCart={fill}
            filling={filling}
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-5 xl:gap-6">
          <RadarPanel focus={focus} extraStores={extraStores} />
          <NeedsDeals
            refreshKey={refreshKey}
            active={query}
            onPick={(q) => {
              setPlan(null);
              setQuery(q);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
          <CartPanel fill={fill} filling={filling} />
        </div>
      </div>
    </div>
  );
}
