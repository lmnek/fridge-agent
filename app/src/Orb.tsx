import { lazy, Suspense, type ComponentType } from "react";
import { bigStyle, useOrbDev } from "./orb/dev";
import Legacy from "./orb/Legacy";
import type { Levels, OrbVariantProps } from "./orb/types";
import type { Status } from "./realtime";

/**
 * Coldex's orb. The look is picked by `?orb=a|b|c` while we compare variants (part 9); without it,
 * the old fridge light. Each variant lives in `orb/` and only gets `status` and `levels`.
 *   a: glass mesh (a 4D hypercube with a refractive material, three.js)
 *   b: raymarched ice tesseract (one fragment shader)
 *   c: nested cubes receding without end
 */
const variants: Record<string, ComponentType<OrbVariantProps>> = {
  a: lazy(() => import("./orb/A")),
  b: lazy(() => import("./orb/B")),
  c: lazy(() => import("./orb/C")),
};
const Variant = variants[new URLSearchParams(window.location.search).get("orb") ?? ""] ?? Legacy;

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
