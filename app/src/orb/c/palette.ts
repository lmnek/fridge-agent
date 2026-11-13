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

// Awake: clear light ice blue. Highlights white, bodies a clean light blue, `deep` (#1f6f96) is the
// darkest tone so depth and pulses read as deep blue against light blue.
export const ACTIVE: Palette = {
  halo: [104, 182, 220],
  body: [78, 160, 204],
  deep: [31, 111, 150],
  refr: [22, 82, 116],
  core: [255, 255, 255],
  face: [56, 146, 194],
  glint: [255, 255, 255],
  frostBody: [128, 192, 224],
  frost: [255, 255, 255],
  shadow: [22, 72, 100],
  glow: [255, 255, 255],
  glowEdge: [160, 220, 244],
};

// Asleep: frosted glass in shade. Cool grey-blue greys, low contrast, still clearly ice (a hint of
// blue in every grey so it never turns dirty or brown).
export const IDLE: Palette = {
  halo: [154, 168, 180],
  body: [134, 150, 164],
  deep: [98, 114, 130],
  refr: [84, 96, 108],
  core: [238, 242, 245],
  face: [122, 138, 152],
  glint: [236, 240, 244],
  frostBody: [162, 176, 189],
  frost: [244, 247, 249],
  shadow: [52, 60, 68],
  glow: [236, 241, 245],
  glowEdge: [178, 190, 200],
};

// Awake characters, all inside the same light ice-blue family. THINK is a touch deeper and calmer (the ice
// looking inward), SPEAK the brightest and clearest (Coldex's voice lighting it). ACTIVE itself reads as
// listening: clear and attentive.
export const THINK: Palette = {
  ...ACTIVE,
  halo: [92, 166, 210],
  body: [64, 142, 192],
  deep: [26, 98, 140],
  refr: [20, 74, 108],
  face: [48, 132, 184],
  frostBody: [112, 178, 214],
  shadow: [20, 64, 92],
  glowEdge: [140, 204, 236],
};
export const SPEAK: Palette = {
  ...ACTIVE,
  halo: [124, 200, 234],
  body: [92, 176, 218],
  deep: [36, 122, 162],
  refr: [28, 92, 128],
  face: [72, 162, 208],
  frostBody: [150, 208, 236],
  glowEdge: [178, 230, 250],
};

export const clonePalette = (p: Palette): Palette => structuredClone(p);

// The highlights follow `tLight` (the ice lights up first), everything else follows `t` (then the colour
// floods in). Pass one value for both to crossfade evenly.
const BRIGHT = new Set<keyof Palette>(["core", "glint", "frost", "glow", "glowEdge", "halo"]);
const KEYS = Object.keys(ACTIVE) as (keyof Palette)[];
export function mixPalette(out: Palette, a: Palette, b: Palette, t: number, tLight = t) {
  for (const k of KEYS) {
    const o = out[k], x = a[k], y = b[k];
    const tt = BRIGHT.has(k) ? tLight : t;
    o[0] = x[0] + (y[0] - x[0]) * tt;
    o[1] = x[1] + (y[1] - x[1]) * tt;
    o[2] = x[2] + (y[2] - x[2]) * tt;
  }
}

// The awake palette for a blend of characters: ACTIVE (listening), pulled toward THINK by `deep` and toward
// SPEAK by `bright` (both 0..1, eased by the caller). Writes into `out`, no allocation.
export function mixAwake(out: Palette, deep: number, bright: number) {
  for (const k of KEYS) {
    const o = out[k], a = ACTIVE[k], d = THINK[k], s = SPEAK[k];
    for (let j = 0; j < 3; j++) o[j] = a[j] + (d[j] - a[j]) * deep + (s[j] - a[j]) * bright;
  }
}

export const rgb = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
export const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export function mixRgb(a: RGB, b: RGB, t: number) {
  return `rgb(${(a[0] + (b[0] - a[0]) * t) | 0},${(a[1] + (b[1] - a[1]) * t) | 0},${(a[2] + (b[2] - a[2]) * t) | 0})`;
}
