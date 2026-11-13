import { RotateCcw } from "lucide-react";
import { PageHeader } from "../../components/shell/PageHeader";
import { Skeleton } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { ChainsPanel, FoodPrefsPanel, LocationPanel, NotifyPanel } from "./PrefsPanels";
import { CamerasPanel, IntegrationsPanel, TestCallPanel, VoicePanel } from "./SystemPanels";
import { usePrefs } from "./usePrefs";

export function SettingsView() {
  const { prefs, setPrefs, error, loading, reload, save } = usePrefs();

  return (
    <div className="pb-8">
      <PageHeader title="Nastavení" lead="Co běží naostro, kde bydlíš, co jíš a kdy se ti Frida může ozvat." />
      <div className="grid gap-5 lg:grid-cols-2">
        <IntegrationsPanel />

        {error && !prefs ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-tomato/25 bg-tomato/[0.07] px-4 py-3 text-sm lg:col-span-2">
            <span className="text-frost">{error}</span>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={() => void reload()}>
              Zkusit znovu
            </Button>
          </div>
        ) : loading && !prefs ? (
          <>
            <Skeleton className="h-56 rounded-[26px]" />
            <Skeleton className="h-56 rounded-[26px]" />
          </>
        ) : prefs ? (
          <>
            <LocationPanel prefs={prefs} onChange={(location) => setPrefs({ ...prefs, location })} />
            <ChainsPanel prefs={prefs} save={save} />
            <FoodPrefsPanel prefs={prefs} save={save} />
            <NotifyPanel prefs={prefs} save={save} />
          </>
        ) : null}

        <VoicePanel />
        <TestCallPanel allowCalls={prefs?.allow_calls} phone={prefs?.phone_masked} />
        <CamerasPanel />
      </div>
    </div>
  );
}
