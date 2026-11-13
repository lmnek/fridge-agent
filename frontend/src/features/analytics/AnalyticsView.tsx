import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { PageHeader } from "../../components/shell/PageHeader";
import { api } from "../../lib/api";
import type { Analytics } from "../../lib/types";
import { czk, cx, num } from "../../lib/format";
import { useApp } from "../../store/app";
import { Panel, SectionTitle, Skeleton } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { ConsumptionChart } from "./ConsumptionChart";
import { DoorChart } from "./DoorChart";
import { WasteChart } from "./WasteChart";

function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "warm" | "cool" }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-mist">{label}</p>
      <p
        className={cx(
          "display-tight mt-1 text-[30px] leading-none font-semibold",
          tone === "warm" ? "text-apricot" : tone === "cool" ? "text-glacier" : "text-frost",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-haze">{hint}</p>}
    </div>
  );
}

export function AnalyticsView() {
  const summary = useApp((s) => s.summary);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.analytics());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Přehled se nenačetl.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // když se změní inventář, přepočítat (spotřeba a vyhozené jídlo se mění s ním)
  const total = summary?.total_items;
  const waste = summary?.waste_month_czk;
  useEffect(() => {
    if (total === undefined) return;
    const t = window.setTimeout(() => {
      api
        .analytics()
        .then(setData)
        .catch(() => {});
    }, 800);
    return () => window.clearTimeout(t);
  }, [total, waste]);

  return (
    <div className="pb-8">
      <PageHeader title="Přehled" lead="Co se v lednici spotřebuje, co skončí v koši a kolik ušetříš na akcích." />

      {error && !data ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-tomato/25 bg-tomato/[0.07] px-4 py-3 text-sm">
          <span className="text-frost">{error}</span>
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={() => void load()}>
            Zkusit znovu
          </Button>
        </div>
      ) : loading && !data ? (
        <div className="grid gap-5 lg:grid-cols-2" aria-busy="true">
          <Skeleton className="h-44 rounded-[26px] lg:col-span-2" />
          <Skeleton className="h-80 rounded-[26px]" />
          <Skeleton className="h-80 rounded-[26px]" />
        </div>
      ) : data ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* hlavní číslo: úspora, kolem něj stav lednice */}
          <Panel className="grid gap-6 lg:col-span-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)] lg:items-end">
            <div>
              <p className="text-sm text-mist">Ušetřeno na akcích tento měsíc</p>
              <p className="display-tight mt-2 text-[56px] leading-[0.9] font-semibold text-glacier sm:text-[72px]">
                {czk(data.savings_month_czk, { whole: true })}
              </p>
              <p className="mt-2 text-sm text-mist">
                Rozdíl proti běžné ceně u věcí koupených v akci.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Stat label="Dveře dnes" value={`${num(data.door_opens_today, 0)}×`} hint="otevření lednice" />
              <Stat
                label="Čerstvost"
                value={summary ? `${summary.freshness_score}` : "–"}
                hint="ze 100"
                tone={summary && summary.freshness_score >= 70 ? "cool" : undefined}
              />
              <Stat label="Hodnota uvnitř" value={summary ? czk(summary.value_czk, { whole: true }) : "–"} />
              <Stat
                label="Vyhozeno tento měsíc"
                value={summary ? czk(summary.waste_month_czk, { whole: true }) : "–"}
                tone={summary && summary.waste_month_czk > 0 ? "warm" : undefined}
              />
            </div>
          </Panel>

          <Panel aria-labelledby="consumption" className="lg:row-span-2">
            <SectionTitle id="consumption">Co sníš za týden</SectionTitle>
            <p className="-mt-1 mb-4 text-sm text-mist">Průměr za poslední týdny a odhad, kdy co dojde.</p>
            <ConsumptionChart data={data.consumption} />
          </Panel>

          <Panel aria-labelledby="waste">
            <SectionTitle id="waste">Vyhozeno po měsících</SectionTitle>
            <p className="-mt-1 mb-3 text-sm text-mist">Kolik korun skončilo v koši.</p>
            <WasteChart data={data.waste_by_month} />
          </Panel>

          <Panel aria-labelledby="door">
            <SectionTitle id="door">Kdy se dnes otevírala lednice</SectionTitle>
            <p className="-mt-1 mb-3 text-sm text-mist">Podle hodin. Aktuální hodina svítí.</p>
            <DoorChart data={data.door_opens_by_hour} />
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
