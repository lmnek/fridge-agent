/**
 * HACK(demo): staged item recognition over the kitchen inset. The fridge phone and the ham are both static, so a
 * calibrated, fixed box looks the same as real detection. No pixels are read (the stream is a cross-origin iframe).
 *
 * Runs ~3 s after the inset first shows; the box stays until the inset hides (door close).
 * S replays the scan. C toggles calibration: drag a rectangle over the item, it saves to localStorage.
 */
import { useEffect, useRef, useState } from "react";

// Everything the label says, in one place.
const ITEM = {
  tag: "ham",
  confidence: 0.97,
  title: "Ham",
  lines: ["Šunka · 100 g", "opened 2 days ago · eat today"],
};

type Box = { x: number; y: number; w: number; h: number }; // fractions of the inset
const STORE = "coldex.recog.box";
const DEFAULT_BOX: Box = { x: 0.36, y: 0.52, w: 0.24, h: 0.26 };
const DELAY_MS = 3000;
const SCAN_MS = 1300;

function loadBox(): Box {
  try {
    const b = JSON.parse(localStorage.getItem(STORE) ?? "");
    if (typeof b?.x === "number") return b;
  } catch {
    /* default */
  }
  return DEFAULT_BOX;
}

export const RECOG_HELP: [string, string][] = [
  ["S", "Kitchen camera: replay the ham recognition"],
  ["C", "Kitchen camera: calibrate the box (drag over the item, C again to finish)"],
];

export function Recognition({ visible }: { visible: boolean }) {
  const [box, setBox] = useState(loadBox);
  const [run, setRun] = useState(0); // 0 = nothing showing; each replay bumps it so the animation restarts
  const [locked, setLocked] = useState(false);
  const [conf, setConf] = useState(0);
  const [calib, setCalib] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // First show: start after a beat. Hiding clears it.
  useEffect(() => {
    if (!visible) {
      setRun(0);
      return;
    }
    const t = setTimeout(() => setRun((r) => r + 1), DELAY_MS);
    return () => clearTimeout(t);
  }, [visible]);

  // One run: sweep, then lock and tick the confidence up.
  useEffect(() => {
    setLocked(false);
    setConf(0);
    if (!run) return;
    let raf = 0;
    const lock = setTimeout(() => {
      setLocked(true);
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / 900);
        setConf(0.41 + (ITEM.confidence - 0.41) * (1 - (1 - p) ** 3));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, SCAN_MS);
    return () => {
      clearTimeout(lock);
      cancelAnimationFrame(raf);
    };
  }, [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "s") setRun((r) => r + 1);
      if (k === "c") setCalib((c) => !c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fractions from the on-screen rect, so the stage's scale-to-fit doesn't matter.
  const frac = (e: React.PointerEvent) => {
    const r = layer.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const onDown = (e: React.PointerEvent) => {
    drag.current = frac(e);
    layer.current!.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const a = drag.current;
    const b = frac(e);
    setBox({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setBox((b) => {
      localStorage.setItem(STORE, JSON.stringify(b));
      return b;
    });
    setRun((r) => r + 1);
  };

  const showing = calib || run > 0;
  const labelLeft = box.x + box.w > 0.62; // no room on the right: hang the label on the left
  const pct = (n: number) => `${n * 100}%`;

  return (
    <div
      ref={layer}
      className="recog"
      data-calib={calib}
      onPointerDown={calib ? onDown : undefined}
      onPointerMove={calib ? onMove : undefined}
      onPointerUp={calib ? onUp : undefined}
    >
      <style>{CSS}</style>
      {showing ? (
        <div
          key={run}
          className="recog-box"
          data-locked={locked || calib}
          style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}
        >
          <i className="c tl" />
          <i className="c tr" />
          <i className="c bl" />
          <i className="c br" />
          {!locked && !calib ? <span className="recog-sweep" /> : null}
          <span className="recog-tag">
            {locked || calib ? `${ITEM.tag} ${conf.toFixed(2)}` : "scanning"}
          </span>
          {locked && !calib ? (
            <div className="recog-label" data-side={labelLeft ? "left" : "right"}>
              <span className="recog-leader" />
              <div className="recog-panel">
                <p className="recog-title">{ITEM.title}</p>
                {ITEM.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {calib ? <p className="recog-hint">Drag over the item · C to finish</p> : null}
    </div>
  );
}

const ICE = "#a9dcf0";
const CSS = `
.recog { position: absolute; inset: 0; pointer-events: none; font-family: "Barlow Semi Condensed", "Barlow", sans-serif; }
.recog[data-calib="true"] { pointer-events: auto; cursor: crosshair; background: rgba(20, 34, 43, 0.25); }
.recog-box { position: absolute; transition: transform 260ms cubic-bezier(0.2, 0, 0, 1); transform: scale(1.12); }
.recog-box[data-locked="true"] { transform: scale(1); }
.recog-box .c { position: absolute; width: 22px; height: 22px; border: 0 solid ${ICE}; opacity: 0.55; transition: opacity 200ms; }
.recog-box[data-locked="true"] .c { opacity: 1; }
.recog-box .tl { left: 0; top: 0; border-left-width: 3px; border-top-width: 3px; }
.recog-box .tr { right: 0; top: 0; border-right-width: 3px; border-top-width: 3px; }
.recog-box .bl { left: 0; bottom: 0; border-left-width: 3px; border-bottom-width: 3px; }
.recog-box .br { right: 0; bottom: 0; border-right-width: 3px; border-bottom-width: 3px; }
.recog-sweep { position: absolute; left: 0; right: 0; top: 0; height: 2px; background: ${ICE}; box-shadow: 0 0 10px ${ICE}; animation: recog-sweep ${SCAN_MS / 2}ms ease-in-out 2 alternate; }
@keyframes recog-sweep { from { top: 0; } to { top: calc(100% - 2px); } }
.recog-tag { position: absolute; left: 0; top: -26px; padding: 1px 7px; background: ${ICE}; color: #14222b; font-size: 15px; font-weight: 600; letter-spacing: 0.03em; font-variant-numeric: tabular-nums; }
.recog-label { position: absolute; top: 0; display: flex; align-items: flex-start; animation: recog-in 320ms cubic-bezier(0.2, 0, 0, 1) both; }
.recog-label[data-side="right"] { left: 100%; }
.recog-label[data-side="left"] { right: 100%; flex-direction: row-reverse; }
.recog-leader { width: 34px; height: 2px; margin-top: 14px; background: ${ICE}; flex: none; }
.recog-panel { background: #f3f6f7; color: #14222b; border-left: 3px solid #1f6f96; border-radius: 4px; padding: 8px 14px 9px; white-space: nowrap; font-size: 16px; line-height: 1.3; }
.recog-panel p { margin: 0; color: #586a75; }
.recog-panel .recog-title { color: #14222b; font-size: 22px; font-weight: 600; margin-bottom: 2px; }
.recog-hint { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); margin: 0; padding: 4px 12px; background: #14222b; color: ${ICE}; font-size: 16px; }
@keyframes recog-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
`;
