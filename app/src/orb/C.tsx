import { useEffect, useRef } from "react";
import { ACTIVE, clonePalette, IDLE, mixAwake, mixPalette, mixRgb, rgb, rgba } from "./c/palette";
import { createLife } from "./c/life";
import type { OrbVariantProps } from "./types";

/**
 * Variant C: an ice cube with cubes inside it, receding without end. N nested cubes sit at
 * exponential scales along a phase that cycles forever, so cubes keep emerging from the centre,
 * growing out and dissolving into the outer shell (or sinking inward while thinking). Every inner
 * cube carries an extra twist that unwinds as it grows, so the stack folds through itself like a
 * tesseract. Plain Canvas 2D, own projection, about a hundred strokes a frame, no blur or filters.
 */

const N = 7; // cycling inner cubes
const S_MIN = 0.07; // scale of a cube as it is born at the centre (the shell is 1)
const CAM = 5.2; // camera distance in cube half-sizes
const L = norm3(-0.55, 0.7, 0.5); // key light: upper left, a little in front
const TW = norm3(0.3, 1, 0.22); // axis the inner cubes twist around

// cube: vertex i has coords (bit0, bit1, bit2) mapped to +-1
const VX = new Float32Array(8);
const VY = new Float32Array(8);
const VZ = new Float32Array(8);
for (let i = 0; i < 8; i++) {
  VX[i] = i & 1 ? 1 : -1;
  VY[i] = i & 2 ? 1 : -1;
  VZ[i] = i & 4 ? 1 : -1;
}
// edges: [a, b, outward normal (unnormalised, the two fixed coords)]
const EDGES: number[][] = [];
for (let i = 0; i < 8; i++)
  for (let bit = 1; bit < 8; bit <<= 1)
    if (!(i & bit)) {
      const j = i | bit;
      EDGES.push([i, j, bit === 1 ? 0 : VX[i], bit === 2 ? 0 : VY[i], bit === 4 ? 0 : VZ[i]]);
    }
// faces: [nx, ny, nz, v0, v1, v2, v3] in cyclic order
const FACES: number[][] = [];
for (let axis = 0; axis < 3; axis++)
  for (const sign of [0, 1]) {
    const a = 1 << axis;
    const b = 1 << ((axis + 1) % 3);
    const c = 1 << ((axis + 2) % 3);
    const base = sign ? a : 0;
    const n = [0, 0, 0];
    n[axis] = sign ? 1 : -1;
    FACES.push([n[0], n[1], n[2], base, base | b, base | b | c, base | c]);
  }

const FROST_PER_EDGE = 26;
// frost on the shell: tiny crystals in every direction (feathery, not dashes) hugging the edges, piling up
// and creeping further onto the faces toward the corners. Bucket 2 (brightest) is most likely at corners.
const FROST = (() => {
  const out: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [a, b, nx, ny, nz] of EDGES) {
    const dx = VX[b] - VX[a], dy = VY[b] - VY[a], dz = VZ[b] - VZ[a];
    for (let k = 0; k < FROST_PER_EDGE; k++) {
      let t = Math.pow(rnd(), 1.9) * 0.5;
      if (k & 1) t = 1 - t;
      const corner = 1 - Math.min(t, 1 - t) * 2; // 1 at a corner, 0 mid-edge
      // step inward on one of the two faces that meet at this edge
      const useFirst = rnd() < 0.5;
      const inset = 0.003 + Math.pow(rnd(), 2.2) * (0.018 + corner * corner * 0.09);
      // the edge normal has two non-zero coords, one per adjacent face; step against one of them
      const opts = [nx ? 0 : -1, ny ? 1 : -1, nz ? 2 : -1].filter((o) => o >= 0);
      const pick = opts[useFirst ? 0 : 1];
      const ix = pick === 0 ? -nx : 0, iy = pick === 1 ? -ny : 0, iz = pick === 2 ? -nz : 0;
      const px = VX[a] + dx * t * 1 + ix * inset;
      const py = VY[a] + dy * t + iy * inset;
      const pz = VZ[a] + dz * t + iz * inset;
      // a short crystal at any angle in the face plane (edge direction is length 2, hence the 0.5)
      const ang = rnd() * Math.PI;
      const len = 0.006 + Math.pow(rnd(), 2) * (0.016 + corner * 0.03);
      const ca = Math.cos(ang) * len * 0.25, sa = Math.sin(ang) * len * 0.5;
      const qx = dx * ca + ix * sa, qy = dy * ca + iy * sa, qz = dz * ca + iz * sa;
      const bk = Math.min(2, Math.floor(rnd() * 2.2 + corner * 0.9));
      out.push(px - qx, py - qy, pz - qz, px + qx, py + qy, pz + qz, bk);
    }
  }
  return new Float32Array(out);
})();
const FROST_EDGE = (() => {
  // which edge each crystal belongs to (FROST_PER_EDGE per edge, in order)
  const e = new Uint8Array(FROST.length / 7);
  for (let i = 0; i < e.length; i++) e[i] = Math.floor(i / FROST_PER_EDGE);
  return e;
})();

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Spring = { x: number; v: number };
const spring = (x: number): Spring => ({ x, v: 0 });
function step(s: Spring, target: number, dt: number, k = 22, zeta = 0.62) {
  const c = 2 * Math.sqrt(k) * zeta;
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
}

export default function OrbC({ status, levels }: OrbVariantProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let W = 1, H = 1;
    // Lighter mode for weak hardware (the tablet): the frame-time watchdog in draw() sets it. Skip optional
    // extras (extra strokes, tracers, gradients) when it is on.
    let lite = new URLSearchParams(window.location.search).has("orblite");
    let slowFrames = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 2);
      W = Math.max(1, canvas.clientWidth);
      H = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    // Resizing clears the canvas after this frame's draw, so redraw at once or it blanks while the stage glides.
    const ro = new ResizeObserver(() => {
      resize();
      cancelAnimationFrame(raf);
      draw(performance.now());
    });
    ro.observe(canvas);

    // smoothed state
    const spin = spring(0.12), flow = spring(0.07), twist = spring(0.55), light = spring(0.7), lean = spring(0);
    const pulse = spring(0);
    const active = spring(0); // 0 idle grey ice .. 1 awake ice blue: crossfades the palette
    const wake = spring(0); // the same, but faster: the highlights light up before the colour floods in
    const pal = clonePalette(IDLE);
    // per-state character, eased slowly so every state change is a long crossfade: the awake colour
    // (deep: thinking, bright: speaking) and the base motion each state settles into
    const awakePal = clonePalette(ACTIVE), deepK = spring(0), brightK = spring(0);
    const spinB = spring(0.07), flowB = spring(0.045), twistB = spring(0.45), lightB = spring(0.45);
    const life = createLife(EDGES, N); // depth colour, travelling waves, edge tracers (c/life.ts)
    let shadowKey = "", shadowGrad: CanvasGradient | null = null;
    let lvlIn = 0, lvlOut = 0, slowOut = 0;
    let yaw = 0.62, phase = 0.3, last = performance.now(), raf = 0;

    // per-frame scratch (no allocations in the loop besides paths and two gradients)
    const R = new Float64Array(9), T = new Float64Array(9), M = new Float64Array(9);
    const PX = new Float32Array(8), PY = new Float32Array(8), PZ = new Float32Array(8);
    const SX = new Float32Array(8), SY = new Float32Array(8);
    const front = new Uint8Array(12), lit = new Float32Array(12);
    const cubeS = new Float32Array(N + 2), cubeU = new Float32Array(N + 2), cubeA = new Float32Array(N + 2);
    const order = new Uint8Array(N);

    let cx = 0, cy = 0, unit = 1, px = 1, oz = 0;

    const rotShared = (yawA: number, pitch: number, roll: number) => {
      const cy_ = Math.cos(yawA), sy_ = Math.sin(yawA);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cr = Math.cos(roll), sr = Math.sin(roll);
      // R = Rz(roll) * Rx(pitch) * Ry(yaw)
      const a00 = cy_, a01 = 0, a02 = sy_;
      const a10 = sp * sy_, a11 = cp, a12 = -sp * cy_;
      const a20 = -cp * sy_, a21 = sp, a22 = cp * cy_;
      R[0] = cr * a00 - sr * a10; R[1] = cr * a01 - sr * a11; R[2] = cr * a02 - sr * a12;
      R[3] = sr * a00 + cr * a10; R[4] = sr * a01 + cr * a11; R[5] = sr * a02 + cr * a12;
      R[6] = a20; R[7] = a21; R[8] = a22;
    };
    const twistInto = (theta: number) => {
      const [x, y, z] = TW;
      const c = Math.cos(theta), s = Math.sin(theta), k = 1 - c;
      T[0] = c + x * x * k; T[1] = x * y * k - z * s; T[2] = x * z * k + y * s;
      T[3] = y * x * k + z * s; T[4] = c + y * y * k; T[5] = y * z * k - x * s;
      T[6] = z * x * k - y * s; T[7] = z * y * k + x * s; T[8] = c + z * z * k;
      for (let r = 0; r < 3; r++)
        for (let col = 0; col < 3; col++)
          M[r * 3 + col] = R[r * 3] * T[col] + R[r * 3 + 1] * T[3 + col] + R[r * 3 + 2] * T[6 + col];
    };
    // project the cube with matrix M and scale s; fills PX..SY, front, lit
    const project = (s: number) => {
      for (let i = 0; i < 8; i++) {
        const x = VX[i] * s, y = VY[i] * s, z = VZ[i] * s;
        const X = M[0] * x + M[1] * y + M[2] * z;
        const Y = M[3] * x + M[4] * y + M[5] * z;
        const Z = M[6] * x + M[7] * y + M[8] * z + oz;
        PX[i] = X; PY[i] = Y; PZ[i] = Z;
        const p = (CAM / (CAM - Z)) * px;
        SX[i] = cx + X * p;
        SY[i] = cy - Y * p;
      }
      for (let e = 0; e < 12; e++) {
        const E = EDGES[e];
        const nx = M[0] * E[2] + M[1] * E[3] + M[2] * E[4];
        const ny = M[3] * E[2] + M[4] * E[3] + M[5] * E[4];
        const nz = M[6] * E[2] + M[7] * E[3] + M[8] * E[4];
        const mx = (PX[E[0]] + PX[E[1]]) / 2, my = (PY[E[0]] + PY[E[1]]) / 2, mz = (PZ[E[0]] + PZ[E[1]]) / 2;
        front[e] = nx * -mx + ny * -my + nz * (CAM - mz) > 0 ? 1 : 0;
        lit[e] = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) * 0.7071);
      }
    };

    // tone: 0 = the palette's edge body, 1 = its deep colour (depth and pulses).
    // bevel (the outer shell, 0..1): the edge reads like a bevel catching the key light, a tight bright
    // specular toward the light with a thin dark line right beside it (borrowed from B).
    // glow (0..1): a travelling wave passing this shell, which widens and lifts the soft halo.
    const strokeEdges = (path: Path2D, a: number, w: number, core: number, tone = 0, bevel = 0, glow = 0) => {
      if (a < 0.004) return;
      if (!lite || glow > 0.05) {
        ctx.globalAlpha = Math.min(1, a * (0.11 - bevel * 0.03 + glow * (0.3 - bevel * 0.12)));
        ctx.strokeStyle = rgb(pal.halo);
        ctx.lineWidth = w * (6.5 + glow * 1.5);
        ctx.stroke(path);
      }
      // deep tone is denser too: the inner cubes read as deep blue ink in the ice, not a faded line
      ctx.globalAlpha = Math.min(1, a * (0.58 + bevel * 0.1 + tone * 0.3));
      ctx.strokeStyle = mixRgb(pal.body, pal.deep, tone);
      ctx.lineWidth = w * (2.6 + bevel * 0.4);
      ctx.stroke(path);
      // a darker refraction line on the side away from the light (tighter and darker on a bevel)
      const ox = w * (0.75 - bevel * 0.2), oy = w * (0.85 - bevel * 0.25);
      ctx.translate(ox, oy);
      ctx.globalAlpha = Math.min(1, a * (0.62 + bevel * 0.25));
      ctx.strokeStyle = rgb(pal.refr);
      ctx.lineWidth = w * (0.8 - bevel * 0.2);
      ctx.stroke(path);
      // the crisp white core (the specular), nudged toward the light
      const sx = w * (0.35 + bevel * 0.2), sy = w * (0.4 + bevel * 0.2);
      ctx.translate(-ox - sx, -oy - sy);
      ctx.globalAlpha = Math.min(1, a * core * (1 + bevel * 0.3));
      ctx.strokeStyle = rgb(pal.core);
      ctx.lineWidth = w * (1.05 - bevel * 0.25);
      ctx.stroke(path);
      ctx.translate(sx, sy);
    };

    const faces = (alpha: number, wantFront: boolean, lightK: number, glint = 0) => {
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        const nx = M[0] * F[0] + M[1] * F[1] + M[2] * F[2];
        const ny = M[3] * F[0] + M[4] * F[1] + M[5] * F[2];
        const nz = M[6] * F[0] + M[7] * F[1] + M[8] * F[2];
        const a = F[3], c = F[5];
        const mx = (PX[a] + PX[c]) / 2, my = (PY[a] + PY[c]) / 2, mz = (PZ[a] + PZ[c]) / 2;
        const isFront = nx * -mx + ny * -my + nz * (CAM - mz) > 0;
        if (isFront !== wantFront) continue;
        const d = nx * L[0] + ny * L[1] + nz * L[2];
        ctx.beginPath();
        ctx.moveTo(SX[F[3]], SY[F[3]]);
        ctx.lineTo(SX[F[4]], SY[F[4]]);
        ctx.lineTo(SX[F[5]], SY[F[5]]);
        ctx.lineTo(SX[F[6]], SY[F[6]]);
        ctx.closePath();
        ctx.fillStyle = rgb(pal.face);
        ctx.globalAlpha = alpha * (wantFront ? 0.028 + Math.max(0, -d) * 0.05 : 0.022);
        ctx.fill();
        if (wantFront && d > 0) {
          ctx.fillStyle = rgb(pal.glint);
          ctx.globalAlpha = alpha * d * d * 0.28 * lightK;
          ctx.fill();
          if (glint > 0 && d > 0.2) {
            // a soft diagonal streak of light across the lit faces of the shell
            const g = ctx.createLinearGradient(SX[F[3]], SY[F[3]], SX[F[5]], SY[F[5]]);
            const m = 0.5 + 0.28 * glint;
            g.addColorStop(m - 0.2, rgba(pal.glint, 0));
            g.addColorStop(m - 0.03, rgba(pal.glint, 0.75));
            g.addColorStop(m, rgba(pal.glint, 0.9));
            g.addColorStop(m + 0.09, rgba(pal.glint, 0));
            ctx.fillStyle = g;
            ctx.globalAlpha = Math.min(1, (d - 0.2) * 0.75 * lightK);
            ctx.fill();
          }
        }
      }
    };

    const draw = (now: number) => {
      const rawDt = (now - last) / 1000;
      const dt = Math.min(0.05, rawDt);
      last = now;
      // watchdog: ~1.5 s of mostly slow frames (under ~45 fps, ignoring hitches) switches to lite for good
      if (!lite && !document.hidden && rawDt < 0.25) {
        slowFrames = Math.max(0, slowFrames + (rawDt > 0.022 ? 1 : -0.5));
        if (slowFrames > 60) {
          lite = true;
          resize();
        }
      }
      const t = now / 1000;
      const st = statusRef.current;
      const lv = levels();

      // levels: fast attack, slower release. Listening hears the mic only, speaking hears Coldex only. When
      // the state moves on, a level drains over ~0.7 s instead of dropping with the voice's own release.
      const tin = st === "listening" ? Math.min(1, lv.input) : 0;
      const tout = st === "speaking" ? Math.min(1, lv.output) : 0;
      lvlIn += (tin - lvlIn) * (1 - Math.exp(-dt / (tin > lvlIn ? 0.06 : st === "listening" ? 0.25 : 0.7)));
      lvlOut += (tout - lvlOut) * (1 - Math.exp(-dt / (tout > lvlOut ? 0.06 : st === "speaking" ? 0.25 : 0.7)));
      slowOut += (lvlOut - slowOut) * (1 - Math.exp(-dt / 0.45));
      const stress = Math.min(1.2, Math.max(0, lvlOut - slowOut) * 3.4);

      // per-state motion. Each state sets a base (spin, flow, twist, light) that glides there on a slow,
      // nearly critically damped spring (~1.5 s, a whisper of overshoot, so a change feels springy but
      // never bounces); the live mic / voice level rides on top through the faster springs below.
      // off: asleep, slow and dim. connecting: a quick searching spin that shimmers. listening: still,
      // leans in with the mic. thinking: flows inward and breathes light. speaking: driven by Coldex.
      let bSpin = 0.07, bFlow = 0.045, bTwist = 0.45, bLight = 0.45, tDeep = 0, tBright = 0, shimmer = 0;
      if (st === "connecting") { bSpin = 0.95; bFlow = 0.26; bTwist = 0.9; bLight = 0.8; shimmer = Math.sin(t * 5.2) * 0.12; tBright = 0.3; }
      else if (st === "listening") { bSpin = 0.13; bFlow = 0.07; bTwist = 0.58; bLight = 0.88; }
      else if (st === "thinking") { bSpin = 0.3; bFlow = -0.4; bTwist = 1; bLight = 0.8; shimmer = Math.sin(t * 2.4) * 0.1; tDeep = 1; }
      else if (st === "speaking") { bSpin = 0.2; bFlow = 0.1; bTwist = 0.62; bLight = 0.95; tBright = 0.55; }
      const awake = st !== "off";
      step(spinB, bSpin, dt, 2.6, 0.92);
      step(flowB, bFlow, dt, 2.2, 0.95); // the flow reversal into thinking takes ~1.8 s
      step(twistB, bTwist, dt, 2.4, 0.92);
      step(lightB, bLight, dt, awake ? 5 : 2.2, awake ? 0.9 : 1);
      step(deepK, tDeep, dt, 2.2, 1);
      step(brightK, tBright + lvlOut * 0.45, dt, 7, 1);
      // live layer: the level terms, fast and lightly damped so the voice still kicks
      step(spin, spinB.x + lvlIn * 0.08 + lvlOut * 1.2, dt, 6, 0.9);
      step(flow, flowB.x + lvlIn * 0.06 + lvlOut * 0.28, dt, 8, 0.9);
      step(twist, twistB.x + lvlIn * 0.15 + lvlOut * 0.45, dt, 8, 0.85);
      step(light, lightB.x + shimmer + lvlIn * 0.7 + lvlOut * 0.8, dt, 30, 0.8);
      step(lean, lvlIn, dt, 40, 0.6);
      step(pulse, stress, dt, 120, 0.45);
      // waking: the ice lights up first (~0.5 s), then the colour floods in (~1.3 s), both critically
      // damped. Falling asleep is slower: the colour drains first (~2 s), the light follows (~2.6 s).
      step(wake, awake ? 1 : 0, dt, awake ? 30 : 2.4, 1);
      step(active, awake ? 1 : 0, dt, awake ? 8 : 3.6, 1);
      const ax = Math.min(1, Math.max(0, active.x)), wx = Math.min(1, Math.max(0, wake.x));
      const dk = Math.min(1, Math.max(0, deepK.x)), bk = Math.min(1, Math.max(0, brightK.x));
      mixAwake(awakePal, dk * dk * (3 - 2 * dk), bk * bk * (3 - 2 * bk));
      mixPalette(pal, IDLE, awakePal, ax * ax * (3 - 2 * ax), wx);

      yaw += spin.x * dt;
      phase += (flow.x + Math.max(0, pulse.x) * 0.9) * dt;
      phase -= Math.floor(phase);

      // placement: bob, drift, lean toward the viewer
      unit = W / 440;
      const bob = Math.sin(t * 0.62) * 0.032 + Math.sin(t * 0.27 + 1.3) * 0.012;
      cx = W / 2 + Math.sin(t * 0.21) * W * 0.012;
      cy = H / 2 - bob * H;
      oz = lean.x * 0.55;
      const breathe = 1 + Math.sin(t * 0.9) * 0.012;
      px = W * 0.172 * breathe;
      const pitch = 0.44 + Math.sin(t * 0.31) * 0.09 + lean.x * 0.12;
      const roll = Math.sin(t * 0.23) * 0.07 + (st === "connecting" ? Math.sin(t * 3) * 0.04 : 0);
      rotShared(yaw, pitch, roll);
      const fold = twist.x * (1 + Math.sin(t * 0.37) * 0.25);
      const lk = light.x;

      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // soft contact shadow on the enamel, smaller as it rises (one cached unit gradient, rebuilt only
      // while the shadow colour is crossfading)
      {
        const sy = H / 2 + W * 0.315;
        const r = W * (0.21 - bob * 0.6);
        const key = rgb(pal.shadow);
        if (key !== shadowKey || !shadowGrad) {
          shadowKey = key;
          shadowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          shadowGrad.addColorStop(0, rgba(pal.shadow, 0.09));
          shadowGrad.addColorStop(0.55, rgba(pal.shadow, 0.035));
          shadowGrad.addColorStop(1, rgba(pal.shadow, 0));
        }
        ctx.save();
        ctx.translate(W / 2, sy);
        ctx.scale(r, r * 0.16);
        ctx.fillStyle = shadowGrad;
        ctx.globalAlpha = (1 - bob * 4) * (0.75 + 0.25 * wake.x);
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      }

      // cube list: N cycling cubes (index 0..N-1), the inner rim of the shell (N), the shell (N+1)
      life.frame(dt, t, st, active.x, lvlOut, stress, pal);
      for (let k = 0; k < N; k++) {
        const u = (k + phase) / N;
        // the stressed-syllable swell, plus the travelling wave nudging each shell out as it passes
        const pul = 1 + Math.max(0, pulse.x) * 0.22 * Math.sin(Math.PI * Math.min(1, u * 1.15)) + life.waveAt(u) * 0.045;
        cubeU[k] = u;
        cubeS[k] = S_MIN * Math.pow(1 / S_MIN, u) * 0.97 * pul;
        cubeA[k] = smooth(0.06, 0.34, u) * (1 - smooth(0.8, 1, u));
        order[k] = k;
      }
      // sort cycling cubes small to large (insertion sort over 7)
      for (let i = 1; i < N; i++) {
        const v = order[i];
        let j = i - 1;
        while (j >= 0 && cubeS[order[j]] > cubeS[v]) { order[j + 1] = order[j]; j--; }
        order[j + 1] = v;
      }
      cubeU[N] = 1; cubeS[N] = 0.9; cubeA[N] = 0.35;
      cubeU[N + 1] = 1; cubeS[N + 1] = 1 + Math.max(0, pulse.x) * 0.03 + life.waveAt(1) * 0.012; cubeA[N + 1] = 1;

      const twistOf = (c: number) => (c >= N ? 0 : fold * Math.min(1 - cubeU[c], 0.5) * 1.9);
      const widthOf = (c: number) =>
        c === N + 1 ? Math.max(1.7, unit * 1.3) : c === N ? Math.max(0.8, unit * 0.6) : Math.max(0.75 + 0.6 * cubeU[c], unit * (0.35 + 0.6 * cubeU[c]));
      // per-cube depth tone for the edge body (0 body .. 1 deep); the active animation drives this
      const depthOf = (c: number) => (c === N + 1 ? 1 : c === N ? 0.96 : cubeU[c]);
      const toneOf = (c: number) => life.toneAt(depthOf(c));
      // white core: brighter outward, and lit up as a wave passes through the shell
      const coreOf = (c: number) =>
        (c >= N ? 0.55 + 0.35 * lk : ((0.25 + 0.55 * cubeU[c]) * (0.7 + 0.3 * lk) + Math.max(0, pulse.x) * 0.3) * (1 - 0.55 * toneOf(c))) +
        life.waveAt(depthOf(c)) * 1.3;

      // pass 1: back faces and back edges, outer to inner
      for (let ii = N + 1; ii >= 0; ii--) {
        const c = ii >= N ? ii : order[ii];
        const a = cubeA[c];
        if (a < 0.004) continue;
        twistInto(twistOf(c));
        project(cubeS[c]);
        faces(a, false, lk);
        const back = new Path2D();
        for (let e = 0; e < 12; e++) {
          if (front[e]) continue;
          const E = EDGES[e];
          back.moveTo(SX[E[0]], SY[E[0]]);
          back.lineTo(SX[E[1]], SY[E[1]]);
        }
        strokeEdges(back, a * 0.55, widthOf(c) * 0.85, coreOf(c) * 0.6, toneOf(c), 0, life.waveAt(depthOf(c)) * 0.5);
        if (!lite) life.drawTracers(ctx, c, false, a, widthOf(c) * 0.85, SX, SY, front);
      }

      // the voice, a cool light deep inside the ice
      // (borrowed from B: a soft cold glow deep in the centre that swells with the voice and each wave)
      {
        const wc = life.centre(), vo = life.voice();
        const ga = Math.min(1, vo * 0.5 + wc * 0.3 + lean.x * 0.15);
        if (ga > 0.01) {
          const r = px * (0.5 + vo * 0.25 + wc * 0.2);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, rgba(pal.glow, 0.9));
          g.addColorStop(0.3, rgba(pal.glowEdge, 0.4));
          g.addColorStop(1, rgba(pal.glowEdge, 0));
          ctx.fillStyle = g;
          ctx.globalAlpha = ga;
          ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
      }

      // pass 2: front faces and front edges, inner to outer
      for (let ii = 0; ii < N + 2; ii++) {
        const c = ii >= N ? ii : order[ii];
        const a = cubeA[c];
        if (a < 0.004) continue;
        twistInto(twistOf(c));
        project(cubeS[c]);
        faces(a, true, lk, c === N + 1 ? Math.sin(yaw * 1.3 + 0.4) : 0);
        const litP = new Path2D();
        const dimP = new Path2D();
        for (let e = 0; e < 12; e++) {
          if (!front[e]) continue;
          const E = EDGES[e];
          const p = lit[e] > 0.25 ? litP : dimP;
          p.moveTo(SX[E[0]], SY[E[0]]);
          p.lineTo(SX[E[1]], SY[E[1]]);
        }
        const w = widthOf(c);
        const core = coreOf(c);
        const bev = c === N + 1 ? 1 : 0;
        const tone = toneOf(c), glow = life.waveAt(depthOf(c));
        strokeEdges(dimP, a, w, core * 0.75, tone, bev * 0.4, glow);
        strokeEdges(litP, a, w * 1.1, core * 1.35, tone, bev, glow);
        // tracers are solid strokes (no gradients), cheap enough to keep in lite; the sweep is an extra
        life.drawTracers(ctx, c, true, a, w, SX, SY, front);
        if (!lite && c === N + 1) life.drawSweep(ctx, w, cx, cy, px * 1.05, SX, SY, front, lit);

        if (c === N + 1) {
          // frost along the shell's edges, densest at the corners: a soft haze under the brightest
          // crystals, then three brightness layers, and the back ones faint through the ice
          const f0 = new Path2D(), f1 = new Path2D(), f2 = new Path2D();
          const fb = new Path2D();
          const s = cubeS[c];
          for (let i = 0; i < FROST_EDGE.length; i++) {
            const o = i * 7;
            const bk = FROST[o + 6];
            const target = !front[FROST_EDGE[i]] ? fb : bk === 0 ? f0 : bk === 1 ? f1 : f2;
            for (let h = 0; h < 2; h++) {
              const x = FROST[o + h * 3] * s, y = FROST[o + h * 3 + 1] * s, z = FROST[o + h * 3 + 2] * s;
              const X = M[0] * x + M[1] * y + M[2] * z;
              const Y = M[3] * x + M[4] * y + M[5] * z;
              const Z = M[6] * x + M[7] * y + M[8] * z + oz;
              const p = (CAM / (CAM - Z)) * px;
              if (h === 0) target.moveTo(cx + X * p, cy - Y * p);
              else target.lineTo(cx + X * p, cy - Y * p);
            }
          }
          const fw = Math.max(0.85, unit * 0.72);
          const fl = (0.7 + 0.3 * Math.min(1, lk)) * (0.8 + 0.2 * wake.x);
          if (!lite) {
            ctx.strokeStyle = rgb(pal.frostBody);
            ctx.lineWidth = fw * 5;
            ctx.globalAlpha = 0.2 * fl;
            ctx.stroke(f2);
          }
          ctx.strokeStyle = rgb(pal.frost);
          ctx.lineWidth = fw * 1.5;
          ctx.globalAlpha = 0.2 * fl;
          ctx.stroke(f0);
          ctx.lineWidth = fw * 1.1;
          ctx.globalAlpha = 0.42 * fl;
          ctx.stroke(f1);
          ctx.lineWidth = fw * 0.85;
          ctx.globalAlpha = 0.85 * fl;
          ctx.stroke(f2);
          ctx.lineWidth = fw;
          ctx.globalAlpha = 0.16;
          ctx.stroke(fb);
        }
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [levels]);

  return <canvas ref={canvasRef} aria-hidden style={{ width: "100%", height: "100%", display: "block" }} />;
}
