import { useCallback, useEffect, useState } from "react";
import { Hand, PackagePlus, GlassWater } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import type { DemoScene, DemoSceneObject, SimulateAction } from "../../lib/types";
import { useApp } from "../../store/app";
import { cx } from "../../lib/format";
import { DemoTag, Panel, SectionTitle, Skeleton } from "../../ui/bits";
import { PipelineTrace, type TraceRun } from "./PipelineTrace";

let runSeq = 0;

const ACTION_LABEL: Record<SimulateAction, string> = { take: "Vzít", use: "Ubrat", put: "Dát do lednice" };

/** Demo: někdo otevře lednici a něco vezme, upije nebo přinese. Celý řetězec jde vidět živě. */
export function SimulationPanel() {
  const cameras = useApp((s) => s.cameras);
  const items = useApp((s) => s.items);
  const toast = useApp((s) => s.toast);
  const [scene, setScene] = useState<DemoScene | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [run, setRun] = useState<TraceRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setScene(await api.demoScene());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scénu se nepodařilo načíst.");
    }
  }, []);

  // scéna se mění s inventářem (i když simulaci spustí někdo jiný)
  useEffect(() => {
    void load();
  }, [load, items.length]);

  if (scene && !scene.enabled) return null;

  const camName = (id: string) => cameras.find((c) => c.id === id)?.name ?? id;

  const simulate = async (action: SimulateAction, key: string, name: string, cameraId: string | null) => {
    setBusy(`${action}:${key}`);
    const r: TraceRun = {
      id: ++runSeq,
      cameraId,
      label: `${ACTION_LABEL[action]}: ${name}`,
      item: name,
      startedAt: Date.now(),
    };
    setRun(r);
    try {
      const res = await api.simulate({ action, item: key, amount: action === "use" ? 0.35 : undefined });
      if (!res.ok) toast({ title: "Tohle teď nejde", body: res.message, tone: "warning" });
      else if (!cameraId && res.camera_id) setRun({ ...r, cameraId: res.camera_id });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Simulace se nepovedla.";
      toast({ title: "Simulace se nepovedla", body: msg, tone: "critical" });
    } finally {
      setBusy(null);
      void load();
    }
  };

  const presets: { action: SimulateAction; key: string; name: string; label: string; cameraId: string | null }[] = [];
  if (scene) {
    const inside = (k: string) => scene.in_fridge.find((o) => o.key === k);
    const addable = (k: string) => scene.can_add.find((o) => o.key === k);
    const milk = inside("mleko");
    if (milk) presets.push({ action: "take", key: "mleko", name: milk.name, label: "Vezmi mléko", cameraId: milk.camera_id });
    else if (addable("mleko")) presets.push({ action: "put", key: "mleko", name: "Mléko", label: "Dej mléko do lednice", cameraId: null });
    const juice = inside("dzus");
    if (juice && (juice.fill_level ?? 0) > 0.2)
      presets.push({ action: "use", key: "dzus", name: juice.name, label: "Upij džus", cameraId: juice.camera_id });
    const straw = inside("jahody");
    if (straw) presets.push({ action: "take", key: "jahody", name: straw.name, label: "Sněz jahody", cameraId: straw.camera_id });
    else if (addable("jahody")) presets.push({ action: "put", key: "jahody", name: "Jahody", label: "Vrať jahody", cameraId: null });
    const extra = addable("mozzarella") ?? scene.can_add.find((o) => o.key !== "mleko" && o.key !== "jahody");
    if (extra) presets.push({ action: "put", key: extra.key, name: extra.name, label: `Do lednice: ${extra.name}`, cameraId: null });
  }

  const byCamera = (scene?.in_fridge ?? []).reduce<Record<string, DemoSceneObject[]>>((acc, o) => {
    (acc[o.camera_id] ??= []).push(o);
    return acc;
  }, {});

  return (
    <Panel aria-labelledby="sim-title">
      <SectionTitle id="sim-title" aside={<DemoTag>simulace</DemoTag>}>
        Zkus to naživo
      </SectionTitle>
      <p className="-mt-1 mb-4 max-w-2xl text-sm text-mist">
        Klepni na věc a ukázková lednice se otevře, kamera vyfotí, Frida rozpozná změnu a upraví inventář. Sleduj obraz nahoře
        i časovou osu.
      </p>

      {presets.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={`${p.action}-${p.key}`}
              type="button"
              disabled={busy !== null}
              onClick={() => void simulate(p.action, p.key, p.name, p.cameraId)}
              className={cx(
                "inline-flex h-10 items-center gap-2 rounded-full bg-frost px-4 text-sm font-medium text-ink transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50",
                busy === `${p.action}:${p.key}` && "animate-pulse",
              )}
            >
              {p.action === "put" ? <PackagePlus className="size-4" aria-hidden /> : p.action === "use" ? <GlassWater className="size-4" aria-hidden /> : <Hand className="size-4" aria-hidden />}
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4">
        <PipelineTrace run={run} />
      </div>

      {error && <p className="mb-3 text-sm text-tomato">{error}</p>}
      {!scene ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr_0.9fr]">
          {Object.entries(byCamera).map(([camId, objs]) => (
            <div key={camId}>
              <h3 className="mb-2 text-sm font-medium text-frost">V lednici, {camName(camId).toLowerCase()}</h3>
              <ul className="flex flex-wrap gap-1.5">
                {objs.map((o) => {
                  const hasFill = o.fill_level !== null && o.fill_level !== undefined;
                  return (
                    <li key={o.key} className="frost-chip flex items-center gap-1 rounded-full py-1 pr-1 pl-2.5 text-[13px]">
                      <span aria-hidden>{o.emoji}</span>
                      <span className="max-w-[120px] truncate text-frost">{o.name}</span>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void simulate("take", o.key, o.name, camId)}
                        className={cx(
                          "ml-1 inline-flex h-7 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-xs text-frost hover:bg-apricot/20 hover:text-apricot disabled:opacity-40",
                          busy === `take:${o.key}` && "animate-pulse",
                        )}
                        aria-label={`Vzít ${o.name}`}
                      >
                        <Hand className="size-3.5" aria-hidden />
                        Vzít
                      </button>
                      {hasFill && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void simulate("use", o.key, o.name, camId)}
                          className="inline-flex h-7 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-xs text-frost hover:bg-butter/20 hover:text-butter disabled:opacity-40"
                          aria-label={`Upít nebo ubrat ${o.name}`}
                        >
                          <GlassWater className="size-3.5" aria-hidden />
                          {Math.round((o.fill_level ?? 0) * 100)} %
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div>
            <h3 className="mb-2 text-sm font-medium text-frost">Přinést z nákupu</h3>
            <ul className="flex flex-wrap gap-1.5">
              {scene.can_add.map((o) => (
                <li key={o.key}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void simulate("put", o.key, o.name, null)}
                    className={cx(
                      "inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-glacier/30 px-3 text-[13px] text-frost hover:bg-glacier/10 disabled:opacity-40",
                      busy === `put:${o.key}` && "animate-pulse",
                    )}
                    aria-label={`Dát do lednice: ${o.name}`}
                  >
                    <PackagePlus className="size-3.5 text-glacier" aria-hidden />
                    <span aria-hidden>{o.emoji}</span>
                    {o.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Panel>
  );
}
