import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ScanLine } from "lucide-react";
import { useApp } from "../../store/app";
import { useRoute } from "../../store/route";
import { DemoTag, Panel, Ring, SectionTitle } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { cx, daysShort, FRESH_COLOR, freshness, itemAmount } from "../../lib/format";
import { CameraFrame } from "../cameras/CameraFrame";
import { CameraMeta, DoorBadge } from "../cameras/CameraMeta";
import { ActivityTimeline } from "./ActivityTimeline";
import { OrbStage } from "./OrbStage";
import { useScan } from "../inventory/scanStore";

function UseFirst() {
  const items = useApp((s) => s.items);
  const go = useRoute((s) => s.go);
  const list = items
    .filter((i) => i.status !== "out" && i.days_left !== null && i.days_left <= 4)
    .sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0))
    .slice(0, 6);
  return (
    <Panel aria-labelledby="use-first">
      <SectionTitle
        id="use-first"
        aside={
          <button type="button" onClick={() => go("lednice", "konci")} className="text-xs text-mist hover:text-frost">
            Vše
          </button>
        }
      >
        Spotřebuj nejdřív
      </SectionTitle>
      {list.length ? (
        <ul className="-mx-1 space-y-0.5">
          {list.map((i) => {
            const f = freshness(i.days_left);
            const color = FRESH_COLOR[f];
            const v = i.days_left === null ? 1 : Math.max(0.04, Math.min(1, (i.days_left + 1) / 7));
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => go("lednice", "konci")}
                  className="flex w-full items-center gap-3 rounded-xl px-1 py-1.5 text-left hover:bg-white/[0.03]"
                >
                  <Ring value={v} size={38} stroke={3} color={color}>
                    <span className="text-[17px]" aria-hidden>
                      {i.emoji}
                    </span>
                  </Ring>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-frost">{i.name}</span>
                    <span className="block text-xs text-mist">{itemAmount(i)}</span>
                  </span>
                  <span className="tabular text-sm font-medium" style={{ color }}>
                    {daysShort(i.days_left)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-mist">Nic nespěchá. Všechno vydrží aspoň pět dní.</p>
      )}
    </Panel>
  );
}

function CameraGlance() {
  const cameras = useApp((s) => s.cameras);
  const go = useRoute((s) => s.go);
  return (
    <Panel aria-labelledby="cams-glance">
      <SectionTitle
        id="cams-glance"
        aside={
          <button type="button" onClick={() => go("kamery")} className="inline-flex items-center text-xs text-mist hover:text-frost">
            Živě <ChevronRight className="size-3.5" aria-hidden />
          </button>
        }
      >
        Uvnitř
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-1">
        {cameras.map((c) => (
          <button key={c.id} type="button" onClick={() => go("kamery")} className="text-left">
            <CameraFrame camera={c} compact />
            <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5">
              <span className="truncate text-[13px] text-frost">{c.name}</span>
              <DoorBadge cameraId={c.id} className="scale-90" />
            </div>
            <CameraMeta camera={c} className="mt-0.5 px-0.5 max-xl:hidden" />
          </button>
        ))}
      </div>
    </Panel>
  );
}

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Na telefonu chybí boční lišta, tak aspoň jméno a stav spojení. */
function MobileTopBar() {
  const agentMode = useApp((s) => s.agentMode);
  return (
    <div className="mb-1 flex items-center justify-between gap-3 lg:hidden">
      <span className="font-display text-[22px] font-bold tracking-tight text-frost">Frida</span>
      <span className="flex items-center gap-2.5">
        {agentMode === "scripted" && <DemoTag>ukázkový režim</DemoTag>}
        <LiveDot />
      </span>
    </div>
  );
}

const FEED_SHORT = 8;

export function HomeView() {
  const openScan = useScan((s) => s.start);
  const wide = useMedia("(min-width: 1024px)");
  const total = useApp((s) => s.events.length);
  const [expanded, setExpanded] = useState(false);
  const limit = wide || expanded ? 30 : FEED_SHORT;
  return (
    <div
      className={cx(
        "grid gap-5 pb-8",
        "lg:grid-cols-[minmax(0,1fr)_330px]",
        "xl:grid-cols-[264px_minmax(0,1fr)_320px] xl:gap-6",
      )}
    >
      <div className="order-1 min-w-0 lg:col-start-1 lg:row-start-1 xl:col-start-2">
        <MobileTopBar />
        <OrbStage />
      </div>

      <div className="order-2 grid min-w-0 grid-cols-1 content-start gap-5 sm:grid-cols-2 lg:col-start-1 lg:row-start-2 xl:col-start-1 xl:row-start-1 xl:grid-cols-1">
        <UseFirst />
        <CameraGlance />
        <Button variant="glass" size="lg" icon={<ScanLine className="size-5" aria-hidden />} onClick={openScan} className="sm:col-span-2 xl:col-span-1">
          Naskenovat datum spotřeby
        </Button>
      </div>

      <Panel
        as="aside"
        aria-labelledby="live-feed"
        className="order-3 min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100dvh-48px)] lg:overflow-y-auto xl:col-start-3"
      >
        <SectionTitle id="live-feed" aside={<LiveDot />}>
          Co se děje
        </SectionTitle>
        <ActivityTimeline limit={limit} />
        {!wide && !expanded && total > FEED_SHORT && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full text-[13px] text-mist hover:bg-white/[0.04] hover:text-frost"
          >
            Zobrazit starší
            <ChevronDown className="size-4" aria-hidden />
          </button>
        )}
      </Panel>
    </div>
  );
}

function LiveDot() {
  const ws = useApp((s) => s.ws);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-mist">
      <span className="relative flex size-2">
        {ws === "open" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-glacier opacity-60" />}
        <span className={cx("relative inline-flex size-2 rounded-full", ws === "open" ? "bg-glacier" : "bg-butter")} />
      </span>
      {ws === "open" ? "živě" : "připojuji"}
    </span>
  );
}
