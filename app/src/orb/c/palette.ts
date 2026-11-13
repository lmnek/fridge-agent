/**
 * Every colour the C orb uses, as two palettes: IDLE (off) and ACTIVE (awake). C.tsx crossfades them each
 * frame by an eased `active` value (0 idle .. 1 awake) into one live palette. Edges also take a `tone`
 * per cube (0 = the palette's `body`, 1 = its `deep`), which the active animation drives for depth.
 */
export type RGB = [number, number, number];
export type Palette = {
  halo: RGB; // wide soft edge halo
  body: RGB; // the edge body at tone 0
  deep: RGB; // the edge body at tone 1 (depth / pulses)
  refr: RGB; // thin dark refraction line beside each edge
  core: RGB; // crisp edge core
  face: RGB; // translucent face fill
  glint: RGB; // light on the lit faces
  frostBody: RGB; // frost scratches, the blue under-stroke
  frost: RGB; // frost scratches, the bright stroke
  shadow: RGB; // contact shadow on the page
  glow: RGB; // the voice light deep inside, centre
  glowEdge: RGB; // the voice light, outer
};

export const ACTIVE: Palette = {
  halo: [31, 111, 150],
  body: [50, 134, 176],
  deep: [31, 111, 150],
  refr: [20, 72, 102],
  core: [255, 255, 255],
  face: [31, 111, 150],
  glint: [255, 255, 255],
  frostBody: [46, 124, 162],
  frost: [255, 255, 255],
  shadow: [20, 60, 82],
  glow: [255, 255, 255],
  glowEdge: [150, 210, 235],
};

// TODO(part 9, colour pass): a desaturated cool grey ice. Today it equals ACTIVE.
export const IDLE: Palette = structuredClone(ACTIVE);

export const clonePalette = (p: Palette): Palette => structuredClone(p);

export function mixPalette(out: Palette, a: Palette, b: Palette, t: number) {
  for (const k of Object.keys(out) as (keyof Palette)[]) {
    const o = out[k], x = a[k], y = b[k];
    o[0] = x[0] + (y[0] - x[0]) * t;
    o[1] = x[1] + (y[1] - x[1]) * t;
    o[2] = x[2] + (y[2] - x[2]) * t;
  }
}

export const rgb = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
export const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export function mixRgb(a: RGB, b: RGB, t: number) {
  return `rgb(${(a[0] + (b[0] - a[0]) * t) | 0},${(a[1] + (b[1] - a[1]) * t) | 0},${(a[2] + (b[2] - a[2]) * t) | 0})`;
}
