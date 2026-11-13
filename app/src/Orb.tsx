import { lazy, Suspense, type ComponentType } from "react";
import OrbD from "./orb/D";
import { bigStyle, useOrbDev } from "./orb/dev";
import type { Levels, OrbVariantProps } from "./orb/types";
import type { Status } from "./realtime";

/**
 * Coldex's orb: one ice cube with a light in its core (variant D, from B, at 15:30).
 * The retired experiments stay behind `?orb=` and out of the default bundle (three.js only loads for a):
 *   c: the nested cubes receding without end (canvas 2D, the default 14:00-15:30)
 *   a: glass mesh (a 4D hypercube with a refractive material, three.js)
 *   b: raymarched ice tesseract (one fragment shader)
 *   legacy: the old fridge light
 * Each variant lives in `orb/` and only gets `status` and `levels`.
 */
const variants: Record<string, ComponentType<OrbVariantProps>> = {
  a: lazy(() => import("./orb/A")),
  c: lazy(() => import("./orb/C")),
  b: lazy(() => import("./orb/B")),
  legacy: lazy(() => import("./orb/Legacy")),
};
const Variant = variants[new URLSearchParams(window.location.search).get("orb") ?? ""] ?? OrbD;

export function Orb({ status, levels, onToggle }: { status: Status; levels: Levels; onToggle: () => void }) {
  const dev = useOrbDev(status, levels);
  const label = status === "off" ? "Wake Coldex" : status === "connecting" ? "Waking up" : "Put Coldex to sleep";
  return (
    <>
      <button
        type="button"
        className="orb"
        onClick={onToggle}
        aria-label={label}
        aria-pressed={status !== "off"}
        style={dev.big ? bigStyle : undefined}
      >
        <Suspense fallback={null}>
          <Variant status={dev.status} levels={dev.levels} />
        </Suspense>
      </button>
      {dev.panel}
    </>
  );
}
