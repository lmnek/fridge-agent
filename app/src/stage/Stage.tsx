/**
 * The stage view, on the projector (docs/DEMO.md, "Stage view"). The orb speaks on the left with subtitles
 * under it, the side panel on the right follows the agent's tool calls, and the kitchen stream is an inset
 * that's large in A and B and small from C on. Open it at /stage (or ?mode=stage).
 *
 * The stage runs its own Realtime session from C on. Its mic stays off until a hotkey turns it on,
 * otherwise it would answer the kitchen audio coming through the video call.
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
import { beatFor } from "./pick";
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

  const toggle = useCallback(() => {
    if (status !== "off") brain.stop();
    else void wake();
  }, [brain, status, wake]);

  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __stage: { brain } });
  }, [brain]);

  const card = usePanelCard(events);
  const beat = beatFor(card, events);
  const orb = useOrbVoice(brain, status, events);
  const system = events.findLast((e) => e.type === "system");
  const line = error ?? (system ? String(system.message ?? "") : null);

  return (
    <div className="stage-view" data-beat={beat} data-card={card}>
      <section className="stage-voice">
        <div className="stage-orb">
          <Orb status={orb.status} levels={orb.levels} onToggle={toggle} />
        </div>
        <Subtitles events={events} />
      </section>
      <section className="stage-panel">
        <Panel card={card} events={events} />
      </section>
      <KitchenInset size={beat === "A" || beat === "B" ? "large" : "small"} muted={!(beat === "A" || beat === "B")} />
      {line ? <p className="stage-error">{line}</p> : null}
      <Hotkeys brain={brain} wake={wake} />
      <DevPlayer />
    </div>
  );
}
