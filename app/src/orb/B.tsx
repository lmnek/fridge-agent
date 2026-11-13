import Legacy from "./Legacy";
import type { OrbVariantProps } from "./types";

// Placeholder until variant B (raymarched shader) lands.
export default function OrbB(props: OrbVariantProps) {
  return <Legacy {...props} />;
}
