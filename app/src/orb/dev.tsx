import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Status } from "../realtime";
import { fakeVoice } from "./fake";
import type { Levels } from "./types";

/**
 * HACK(demo): a dev control for judging orb variants without a live session. On when the URL has
 * `?orb=` (or `?orbdev`). Press O to step live -> idle -> listening -> thinking -> speaking -> live,
 * or tap the small panel in the bottom-left corner (for the tablet). `&state=speaking` starts in a
 * state, `&big` blows the orb up to stage size. The panel also shows the frame rate.
 */
const params = new URLSearchParams(window.location.search);
export const devOn = params.has("orb") || params.has("orbdev");
const STEPS: (Status | null)[] = [null, "off", "listening", "thinking", "speaking"];
const NAMES: Record<string, string> = { off: "idle", listening: "listen", thinking: "think", speaking: "talk" };

export function useOrbDev(status: Status, levels: Levels) {
  const initial = params.get("state") as Status | null;
  const [override, setOverride] = useState<Status | null>(initial && initial in NAMES ? initial : null);
  const [big, setBig] = useState(params.has("big"));
  const overrideRef = useRef(override);
  overrideRef.current = override;
  const levelsRef = useRef(levels);
  levelsRef.current = levels;

  // One stable function, so variants never restart their render loop when the override changes.
  const devLevels = useCallback<Levels>(() => {
    const o = overrideRef.current;
    if (!o) return levelsRef.current();
    const t = performance.now() / 1000;
    return { input: o === "listening" ? fakeVoice(t + 7.3, 0.7) : 0, output: o === "speaking" ? fakeVoice(t) : 0 };
  }, []);

  useEffect(() => {
    if (!devOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "o" || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      setOverride((cur) => STEPS[(STEPS.indexOf(cur) + 1) % STEPS.length]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return {
    status: devOn ? (override ?? status) : status,
    levels: devOn ? devLevels : levels,
    big: devOn && big,
    panel: devOn ? <DevPanel override={override} setOverride={setOverride} big={big} setBig={setBig} /> : null,
  };
}

export const bigStyle: CSSProperties = {
  position: "fixed",
  zIndex: 40,
  top: "50%",
  left: "50%",
  width: "min(88vh, 88vw)",
  height: "min(88vh, 88vw)",
  transform: "translate(-50%, -50%)",
};

function DevPanel({
  override,
  setOverride,
  big,
  setBig,
}: {
  override: Status | null;
  setOverride: (s: Status | null) => void;
  big: boolean;
  setBig: (b: boolean) => void;
}) {
  const fps = useFps();
  const btn = (on: boolean): CSSProperties => ({
    font: "500 12px/1 Barlow, system-ui, sans-serif",
    padding: "6px 8px",
    border: 0,
    borderRadius: 6,
    background: on ? "rgba(20, 34, 43, 0.85)" : "transparent",
    color: on ? "#fff" : "#586a75",
  });
  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: 4,
        borderRadius: 8,
        background: "rgba(243, 246, 247, 0.7)",
        opacity: 0.55,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.55")}
    >
      {STEPS.map((s) => (
        <button key={s ?? "live"} type="button" style={btn(override === s)} onClick={() => setOverride(s)}>
          {s ? NAMES[s] : "live"}
        </button>
      ))}
      <button type="button" style={btn(big)} onClick={() => setBig(!big)}>
        big
      </button>
      <span data-orb-fps={fps} style={{ font: "500 12px/1 Barlow, system-ui, sans-serif", color: "#586a75", padding: "0 6px" }}>
        {fps} fps
      </span>
    </div>
  );
}

function useFps() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let since = performance.now();
    const loop = (now: number) => {
      frames++;
      if (now - since >= 1000) {
        const v = Math.round((frames * 1000) / (now - since));
        (window as unknown as { __orbFps: number }).__orbFps = v;
        setFps(v);
        frames = 0;
        since = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}
