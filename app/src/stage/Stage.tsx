/**
 * The stage view, on the projector (docs/DEMO.md, "Stage view"). The orb speaks on the left with subtitles
 * under it, the side panel on the right follows the agent's tool calls, and the kitchen stream is an inset
 * that's large in A and B and fades out for good when the door closes (pick.ts `insetGone`).
 * Open it at /stage (or ?mode=stage).
 *
 * One session runs B and C, the kitchen's. The stage's own session is only the T-hotkey fallback (and M,
 * the emergency mic): it never starts by itself and its mic never turns on by itself.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Orb } from "../Orb";
import { FridgeBrain, type Status } from "../realtime";
import { useBus } from "./bus";
import { publishCaption } from "./captions";
import { DevPlayer } from "./DevPlayer";
import { Hotkeys } from "./Hotkeys";
import { KitchenInset } from "./KitchenInset";
import { Panel, usePanelCard } from "./Panel";
import { beatFor, insetGone } from "./pick";
import { Subtitles } from "./Subtitles";
import { useOrbVoice } from "./voice";
import "./stage.css";

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

  const card = usePanelCard(events);
  const beat = beatFor(card, events);
  // Gone once the door closed, or whenever a beat past B is forced without one (H passes: a forced beat
  // shows idle for one render before its card).
  const gone = insetGone(events) || !(beat === "A" || beat === "B" || beat === "H");
  const orb = useOrbVoice(brain, status, events);
  const system = events.findLast((e) => e.type === "system");
  const line = error ?? (system ? String(system.message ?? "") : null);

  return (
    <div className="stage-view" data-beat={beat} data-card={card} data-inset={gone ? "gone" : "large"}>
      <p className="stage-mark">Coldex</p>
      <div className="stage-orb">
        <Orb status={orb.status} levels={orb.levels} onToggle={() => {}} />
      </div>
      <div className="stage-subs">
        <Subtitles events={events} />
      </div>
      <section className="stage-panel">
        <Panel card={card} events={events} />
      </section>
      <KitchenInset size={gone ? "hidden" : "large"} muted={true} />
      {line ? <p className="stage-error">{line}</p> : null}
      <Hotkeys brain={brain} wake={wake} />
      <DevPlayer />
    </div>
  );
}
