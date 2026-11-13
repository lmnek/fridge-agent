import { Canvas } from "@react-three/fiber";
import { IceTesseract, QUALITY } from "./a/IceTesseract";
import type { OrbVariantProps } from "./types";

/**
 * Variant A, glass mesh: a 4D hypercube rotated through XW/YW/ZW and projected to 3D every frame,
 * rendered as clear ice (one merged capsule mesh with a transmission material, local light only).
 * The canvas is transparent so the page shows through; the refraction samples a backdrop that
 * matches the page colour.
 */
export default function OrbA({ status, levels }: OrbVariantProps) {
  return (
    <Canvas
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      dpr={[1, QUALITY.dpr]}
      camera={{ position: [0, 0, 8], fov: 30 }}
      style={{ background: "transparent" }}
    >
      <IceTesseract status={status} levels={levels} />
    </Canvas>
  );
}
