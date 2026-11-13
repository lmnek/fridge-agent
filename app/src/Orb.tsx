import { lazy, Suspense, type ComponentType } from "react";
import OrbC from "./orb/C";
import { bigStyle, useOrbDev } from "./orb/dev";
import type { Levels, OrbVariantProps } from "./orb/types";
import type { Status } from "./realtime";

/**
 * Coldex's orb: the ice cube with cubes inside it receding without end (variant C, picked at 14:00).
 * The retired experiments stay behind `?orb=` and out of the default bundle (three.js only loads for a):
 *   a: glass mesh (a 4D hypercube with a refractive material, three.js)
 *   b: raymarched ice tesseract (one fragment shader)
 *   legacy: the old fridge light
 * Each variant lives in `orb/` and only gets `status` and `levels`.
 */
const variants: Record<string, ComponentType<OrbVariantProps>> = {
  a: lazy(() => import("./orb/A")),
  b: lazy(() => import("./orb/B")),
  legacy: lazy(() => import("./orb/Legacy")),
};
const Variant = variants[new URLSearchParams(window.location.search).get("orb") ?? ""] ?? OrbC;

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
