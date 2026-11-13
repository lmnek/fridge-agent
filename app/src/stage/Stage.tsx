/**
 * The stage view, on the projector (docs/DEMO.md, "Stage view"). The orb is the hero, big and dead centre with
 * its subtitles under it, until something shows: then it glides to the centre of the left half and stays big,
 * and the right half holds one card (the panel follows the agent's tool calls) or the fridge camera, which
 * fades out for good when the door closes (pick.ts `insetGone`). Open it at /stage (or ?mode=stage).
 *
 * One session runs B and C, the kitchen's. The stage's own session is only the T-hotkey fallback (and M,
 * the emergency mic): it never starts by itself and its mic never turns on by itself.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Orb } from "../Orb";
import { FridgeBrain, type Status } from "../realtime";
import { type BusEvent, useBus } from "./bus";
import { publishCaption } from "./captions";
import { DevPlayer } from "./DevPlayer";
import { Hotkeys } from "./Hotkeys";
import { KitchenInset } from "./KitchenInset";
import { Panel, usePanelCard } from "./Panel";
import { beatFor, insetGone } from "./pick";
import { setVideoAudio, startRelay } from "./relay";
import { Subtitles } from "./Subtitles";
import { useOrbVoice } from "./voice";
import "./stage.css";

/**
 * Where the fridge camera goes, `?layout=`:
 *   a (default): it takes the card slot (right half) from B on, the orb beside it, then the B card replaces it
 *   b: a small picture-in-picture in the top right corner from A on, the orb stays the centred hero
 *   c: it takes the card slot from A on, so the audience watches the dark fridge from the first second
 */
const LAYOUT = ((): "a" | "b" | "c" => {
  const l = new URLSearchParams(location.search).get("layout");
  return l === "b" || l === "c" ? l : "a";
})();

/** B has begun: the presenter forced it (key 2, at "Let's watch it work"), or the kitchen started talking or looking. */
function kitchenAwake(events: BusEvent[]): boolean {
  return events.some(
    (e) =>
      (e.type === "stage" && e.beat === "B") ||
      (e.type === "caption" && (e.who === "actor" || e.who === "coldex")) ||
      e.type === "vision" ||
      e.type === "look",
  );
}

/** The composition is drawn at 1920x1080; this scales it to fit any viewport, centred and letterboxed (stage.css). */
function useFit(): number {
  const get = () => Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const [k, setK] = useState(get);
  useEffect(() => {
    const on = () => setK(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return k;
}

export default function Stage() {
  const events = useBus();
  const [status, setStatus] = useState<Status>("off");
  const [error, setError] = useState<string | null>(null);

  const brain = useMemo(() => {
    const b = new FridgeBrain({
      status: setStatus,
      caption: (text, final, id) => publishCaption("coldex", `stage-${id ?? "r"}`, text, Boolean(final)),
      heard: (text, final, id) => publishCaption("presenter", `stage-${id}`, text, final),
      // The stage never asks a human mid-demo. Anything outside the safe list is declined (nothing may order).
      approval: (req) => b.approve(req.id, false),
      error: setError,
    });
    b.setMic(false);
    return b;
  }, []);

  /** Starts the stage session if it's off. The mic stays as it is (off until the C hotkey). */
  const wake = useCallback(async () => {
    if (brain.connected || status !== "off") return;
    setError(null);
    try {
      await brain.start();
    } catch (e) {
      brain.stop();
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [brain, status]);

  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __stage: { brain } });
  }, [brain]);

  // The kitchen relay plays from the first click or key on (browsers only start audio after a gesture).
  // U: the actor through the inset's own mic (camera or phone) instead of the relay's kitchen mic, never both.
  const [videoAudio, setVideo] = useState(false);
  useEffect(() => setVideoAudio(videoAudio), [videoAudio]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() === "u") setVideo((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    window.addEventListener("pointerdown", startRelay, { once: true });
    window.addEventListener("keydown", startRelay, { once: true });
    return () => {
      window.removeEventListener("pointerdown", startRelay);
      window.removeEventListener("keydown", startRelay);
    };
  }, []);

  const card = usePanelCard(events);
  const beat = beatFor(card, events);
  // Gone once the door closed, or whenever a beat past B is forced without one (H passes: a forced beat
  // shows idle for one render before its card).
  const gone = insetGone(events) || !(beat === "A" || beat === "B" || beat === "H");
  // The composition (stage.css): the orb is the hero, dead centre, until something shows. Then it glides to the
  // centre of the left half and the card, or the fridge camera, takes the right half.
  const camera = !gone && (LAYOUT !== "a" || kitchenAwake(events));
  const cardUp = card !== "idle" && !camera;
  const split = cardUp || (camera && LAYOUT !== "b");
  const orb = useOrbVoice(brain, status, events);
  const system = events.findLast((e) => e.type === "system");
  const line = error ?? (system ? String(system.message ?? "") : null);
  const fit = useFit();

  return (
    <div className="stage-fit">
    <div
      className="stage-view"
      style={{ transform: `translate(-50%, -50%) scale(${fit})` }}
      data-layout={LAYOUT}
      data-split={split}
      data-beat={beat}
      data-card={card}
      data-inset={camera ? "large" : "gone"}
      data-orb={orb.status}
    >
      <p className="stage-mark">
        <span className="mark-cube" aria-hidden>{"\u{1F9CA}"}</span>
        Coldex
      </p>
      <div className="stage-orb">
        <Orb status={orb.status} levels={orb.levels} onToggle={() => {}} />
      </div>
      <div className="stage-subs">
        <Subtitles events={events} />
      </div>
      <section className="stage-panel" data-hidden={!cardUp}>
        <Panel card={card} events={events} />
      </section>
      <KitchenInset size={camera ? "large" : "hidden"} muted={!videoAudio} />
      {videoAudio ? <p className="stage-audio">Actor on the camera mic</p> : null}
      {line ? <p className="stage-error">{line}</p> : null}
      <Hotkeys brain={brain} wake={wake} />
      <DevPlayer />
    </div>
    </div>
  );
}
