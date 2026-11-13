import { useEffect, useState } from "react";
import { Aperture, Eye, Radio } from "lucide-react";
import { PageHeader } from "../../components/shell/PageHeader";
import { useApp, isDemoMode } from "../../store/app";
import { api } from "../../lib/api";
import { onWs } from "../../lib/ws";
import type { CameraInfo, Observation } from "../../lib/types";
import { cx, relTime, timeShort } from "../../lib/format";
import { Button } from "../../ui/Button";
import { DemoTag, Panel, SectionTitle } from "../../ui/bits";
import { CameraFrame } from "./CameraFrame";
import { CameraMeta, DoorBadge } from "./CameraMeta";
import { SimulationPanel } from "./SimulationPanel";

function CameraCard({ camera }: { camera: CameraInfo }) {
  const toast = useApp((s) => s.toast);
  const latest = useApp((s) => s.observations[camera.id]);
  const detected = useApp((s) => s.detected[camera.id]);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    setBusy(true);
    try {
      const obs = await api.capture(camera.id);
      if (!obs) toast({ title: `${camera.name}: snímek se nepovedl`, tone: "warning" });
      else
        toast({
          title: `${camera.name}: vyfoceno`,
          body: obs.detections.length ? `Vidím ${obs.detections.length} věcí, trvalo to ${obs.latency_ms} ms.` : (obs.note ?? "Nic jsem nerozpoznala."),
          tone: "success",
        });
    } catch (err) {
      toast({ title: "Kamera neodpověděla", body: err instanceof Error ? err.message : undefined, tone: "critical" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel as="article" aria-label={`Kamera ${camera.name}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-semibold">{camera.name}</h2>
        <DoorBadge cameraId={camera.id} />
        <CameraMeta camera={camera} className="ml-auto" />
      </div>

      <CameraFrame camera={camera} live={live} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="frost-chip inline-flex rounded-full p-0.5" role="group" aria-label="Zobrazení">
          <button
            type="button"
            aria-pressed={live}
            onClick={() => setLive(true)}
            className={cx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px]", live ? "bg-frost text-ink" : "text-mist")}
          >
            <Radio className="size-3.5" aria-hidden />
            Živě
          </button>
          <button
            type="button"
            aria-pressed={!live}
            onClick={() => setLive(false)}
            className={cx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px]", !live ? "bg-frost text-ink" : "text-mist")}
          >
            <Eye className="size-3.5" aria-hidden />
            Poslední snímek
          </button>
        </div>
        <Button variant="primary" size="md" busy={busy} icon={<Aperture className="size-4" aria-hidden />} onClick={() => void capture()} className="ml-auto">
          Vyfotit teď
        </Button>
      </div>

      <div className="space-y-1 text-[13px] text-mist">
        {latest ? (
          <p>
            Poslední snímek {relTime(latest.taken_at)} v {timeShort(latest.taken_at)}.{" "}
            {latest.detections.length ? `Rozpoznáno ${latest.detections.length} věcí za ${latest.latency_ms} ms.` : latest.note}
          </p>
        ) : (
          <p>Zatím žádný snímek. Otevři lednici nebo klepni na Vyfotit teď.</p>
        )}
        {detected && detected.id !== latest?.id && (
          <p className="text-haze">Rámečky jsou z rozpoznání {relTime(detected.taken_at)}.</p>
        )}
        {live && camera.live?.note && <p className="text-haze">{camera.live.note}</p>}
      </div>
    </Panel>
  );
}

function ObservationLog() {
  const cameras = useApp((s) => s.cameras);
  const [list, setList] = useState<Observation[]>([]);
  useEffect(() => {
    api
      .observations(undefined, 10)
      .then(setList)
      .catch(() => setList([]));
    return onWs((env) => {
      if (env.type === "observation") setList((l) => [env.payload as unknown as Observation, ...l].slice(0, 10));
    });
  }, []);
  const name = (id: string) => cameras.find((c) => c.id === id)?.name ?? id;
  if (!list.length) return null;
  return (
    <Panel aria-labelledby="obs-log">
      <SectionTitle id="obs-log">Co kamery viděly</SectionTitle>
      <ul className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {list.map((o) => (
          <li key={o.id} className="w-[180px] shrink-0">
            <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-[#040a14]">
              <img src={o.image_url} alt={`Snímek z kamery ${name(o.camera_id)}`} className="size-full" loading="lazy" />
              {o.detections.length > 0 && (
                <span className="tabular absolute right-1.5 bottom-1.5 rounded-full bg-glacier px-1.5 text-[10.5px] font-semibold text-ink">
                  {o.detections.length}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[12.5px] text-frost">
              {name(o.camera_id)}, {timeShort(o.taken_at)}
            </p>
            <p className="line-clamp-2 text-[11.5px] text-mist">
              {o.detections.length ? o.detections.slice(0, 3).map((d) => d.label).join(", ") : (o.note ?? "Bez rozpoznání")}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function CamerasView() {
  const cameras = useApp((s) => s.cameras);
  const cameraMode = useApp((s) => s.integrations.camera);
  const visionMode = useApp((s) => s.integrations.vision);
  return (
    <div className="space-y-5 pb-6">
      <PageHeader
        title="Kamery"
        lead="Dvě bateriové kamery uvnitř. Když otevřeš dveře, Frida se podívá, co přibylo a co ubylo. Se zavřenými dveřmi je tma, to je v pořádku."
        actions={
          (isDemoMode(cameraMode) || isDemoMode(visionMode)) && (
            <DemoTag>{isDemoMode(cameraMode) ? "simulované kamery" : "ukázkové rozpoznávání"}</DemoTag>
          )
        }
      />
      <div className="grid gap-5 xl:grid-cols-2">
        {cameras.map((c) => (
          <CameraCard key={c.id} camera={c} />
        ))}
      </div>
      <SimulationPanel />
      <ObservationLog />
    </div>
  );
}
