import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { onWs } from "../../lib/ws";
import type { DoorPayload, FridgeEvent, Observation } from "../../lib/types";
import { cx } from "../../lib/format";

export interface TraceRun {
  id: number;
  cameraId: string | null;
  label: string;
  /** název věci, kterou simulace bere nebo přidává, pro výběr té správné změny */
  item?: string;
  startedAt: number;
}

type StepKey = "door" | "photo" | "vision" | "inventory" | "closed";

interface StepState {
  at?: number;
  detail?: string;
}

const STEPS: { key: StepKey; label: string }[] = [
  { key: "door", label: "Dveře se otevřou" },
  { key: "photo", label: "Kamera vyfotí" },
  { key: "vision", label: "Frida rozpozná" },
  { key: "inventory", label: "Lednice se upraví" },
  { key: "closed", label: "Dveře zavřené" },
];

/** Živé sledování jednoho průchodu: dveře, snímek, rozpoznání, inventář. */
export function PipelineTrace({ run }: { run: TraceRun | null }) {
  const [steps, setSteps] = useState<Partial<Record<StepKey, StepState>>>({});
  const [changes, setChanges] = useState<string[]>([]);
  const runRef = useRef(run);
  runRef.current = run;

  const runId = run?.id ?? null;
  useEffect(() => {
    setSteps({});
    setChanges([]);
    if (runId === null) return;
    // běh se může doplnit o kameru až po odpovědi serveru, proto čteme z ref
    const mark = (k: StepKey, detail?: string) =>
      setSteps((s) => (s[k] ? s : { ...s, [k]: { at: Date.now() - (runRef.current?.startedAt ?? Date.now()), detail } }));
    const off = onWs((env) => {
      const r = runRef.current;
      if (!r) return;
      if (env.type === "door") {
        const d = env.payload as unknown as DoorPayload;
        if (r.cameraId && d.camera_id !== r.cameraId) return;
        if (d.open) mark("door");
        else mark("closed");
      } else if (env.type === "observation") {
        const o = env.payload as unknown as Observation;
        if (r.cameraId && o.camera_id !== r.cameraId) return;
        mark("photo", `${o.latency_ms} ms`);
        mark("vision", o.detections.length ? `${o.detections.length} věcí` : (o.note ?? "nic nového"));
      } else if (env.type === "event") {
        const e = env.payload as unknown as FridgeEvent;
        if (e.kind.startsWith("item_")) {
          mark("inventory");
          setChanges((c) => (c.includes(e.title) ? c : [...c, e.title]));
        }
      }
    });
    return off;
  }, [runId]);

  if (!run) return null;
  const done = !!steps.closed;
  const needle = run.item?.toLowerCase();
  const main = (needle && changes.find((t) => t.toLowerCase().includes(needle))) || changes[0];
  const changeDetail = main ? (changes.length > 1 ? `${main} a ${changes.length - 1} další` : main) : undefined;
  return (
    <div className="rounded-2xl bg-white/[0.03] p-3.5" aria-live="polite">
      <p className="mb-3 text-sm text-frost">
        {run.label}
        {done && !steps.inventory && <span className="ml-2 text-mist">Bez změny v lednici.</span>}
      </p>
      <ol className="grid grid-cols-5 gap-1.5">
        {STEPS.map((s, i) => {
          const st = s.key === "inventory" && steps.inventory ? { ...steps.inventory, detail: changeDetail } : steps[s.key];
          const prevDone = i === 0 || !!steps[STEPS[i - 1].key];
          const active = !st && prevDone && !done;
          const skipped = !st && done;
          return (
            <li key={s.key} className="min-w-0">
              <div
                className={cx(
                  "h-1 rounded-full transition-colors duration-500",
                  st ? "bg-glacier shadow-[0_0_10px_var(--color-glacier)]" : active ? "bg-aurora/60" : "bg-white/[0.08]",
                )}
              />
              <div className="mt-2 flex items-start gap-1 text-[11.5px]">
                {st ? (
                  <Check className="size-3 shrink-0 text-glacier" aria-hidden />
                ) : active ? (
                  <LoaderCircle className="size-3 shrink-0 animate-spin text-aurora" aria-hidden />
                ) : null}
                <span className={cx("leading-tight", st ? "text-frost" : skipped ? "text-haze line-through" : "text-mist")}>{s.label}</span>
              </div>
              {st?.detail && <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-mist">{st.detail}</p>}
              {st?.at !== undefined && <p className="tabular text-[10.5px] text-haze">+{(st.at / 1000).toFixed(1)} s</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
