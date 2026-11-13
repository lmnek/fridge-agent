import { useEffect, useRef } from "react";
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

const FROST_PER_EDGE = 13;
// frost on the shell: short irregular scratches hugging the edges, denser toward corners
const FROST = (() => {
  const out: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [a, b, nx, ny, nz] of EDGES) {
    const dx = VX[b] - VX[a], dy = VY[b] - VY[a], dz = VZ[b] - VZ[a];
    for (let k = 0; k < FROST_PER_EDGE; k++) {
      let t = Math.pow(rnd(), 2.6);
      if (k & 1) t = 1 - t;
      // step inward on one of the two faces that meet at this edge
      const useFirst = rnd() < 0.5;
      const inset = 0.004 + Math.pow(rnd(), 2.5) * (0.03 + (0.5 - Math.abs(t - 0.5)) * 0.1);
      // the edge normal has two non-zero coords, one per adjacent face; step against one of them
      const opts = [nx ? 0 : -1, ny ? 1 : -1, nz ? 2 : -1].filter((o) => o >= 0);
      const pick = opts[useFirst ? 0 : 1];
      const ix = pick === 0 ? -nx : 0, iy = pick === 1 ? -ny : 0, iz = pick === 2 ? -nz : 0;
      const px = VX[a] + dx * t + ix * inset;
      const py = VY[a] + dy * t + iy * inset;
      const pz = VZ[a] + dz * t + iz * inset;
      // direction: mostly along the edge, a bit into the face, short
      const ang = (rnd() - 0.5) * 2.2;
      const len = 0.006 + Math.pow(rnd(), 2) * 0.034;
      const ca = Math.cos(ang) * len * 0.5, sa = Math.sin(ang) * len * 0.5;
      const qx = dx * ca + ix * sa, qy = dy * ca + iy * sa, qz = dz * ca + iz * sa;
      out.push(px - qx, py - qy, pz - qz, px + qx, py + qy, pz + qz, Math.floor(rnd() * 2.999));
    }
  }
  return new Float32Array(out);
})();
const FROST_EDGE = (() => {
  // which edge each scratch belongs to (16 per edge, in order)
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
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

    const strokeEdges = (path: Path2D, a: number, w: number, core: number) => {
      if (a < 0.004) return;
      ctx.globalAlpha = a * 0.11;
      ctx.strokeStyle = "rgb(31,111,150)";
      ctx.lineWidth = w * 6.5;
      ctx.stroke(path);
      ctx.globalAlpha = Math.min(1, a * 0.58);
      ctx.strokeStyle = "rgb(50,134,176)";
      ctx.lineWidth = w * 2.6;
      ctx.stroke(path);
      // a darker refraction line on the side away from the light
      ctx.translate(w * 0.75, w * 0.85);
      ctx.globalAlpha = Math.min(1, a * 0.62);
      ctx.strokeStyle = "rgb(20,72,102)";
      ctx.lineWidth = w * 0.8;
      ctx.stroke(path);
      // the crisp white core, nudged toward the light
      ctx.translate(-w * 1.1, -w * 1.25);
      ctx.globalAlpha = Math.min(1, a * core);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = w * 1.05;
      ctx.stroke(path);
      ctx.translate(w * 0.35, w * 0.4);
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
        ctx.fillStyle = "rgb(31,111,150)";
        ctx.globalAlpha = alpha * (wantFront ? 0.028 + Math.max(0, -d) * 0.05 : 0.022);
        ctx.fill();
        if (wantFront && d > 0) {
          ctx.fillStyle = "#fff";
          ctx.globalAlpha = alpha * d * d * 0.28 * lightK;
          ctx.fill();
          if (glint > 0 && d > 0.2) {
            // a soft diagonal streak of light across the lit faces of the shell
            const g = ctx.createLinearGradient(SX[F[3]], SY[F[3]], SX[F[5]], SY[F[5]]);
            const m = 0.5 + 0.28 * glint;
            g.addColorStop(m - 0.2, "rgba(255,255,255,0)");
            g.addColorStop(m - 0.03, "rgba(255,255,255,0.75)");
            g.addColorStop(m, "rgba(255,255,255,0.9)");
            g.addColorStop(m + 0.09, "rgba(255,255,255,0)");
            ctx.fillStyle = g;
            ctx.globalAlpha = Math.min(1, (d - 0.2) * 0.75 * lightK);
            ctx.fill();
          }
        }
      }
    };

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const st = statusRef.current;
      const lv = levels();

      // levels: fast attack, slower release
      const tin = st === "listening" ? Math.min(1, lv.input) : 0;
      const tout = st === "speaking" ? Math.min(1, lv.output) : 0;
      lvlIn += (tin - lvlIn) * (1 - Math.exp(-dt / (tin > lvlIn ? 0.06 : 0.25)));
      lvlOut += (tout - lvlOut) * (1 - Math.exp(-dt / (tout > lvlOut ? 0.06 : 0.25)));
      slowOut += (lvlOut - slowOut) * (1 - Math.exp(-dt / 0.45));
      const stress = Math.min(1.2, Math.max(0, lvlOut - slowOut) * 3.4);

      let tSpin = 0.12, tFlow = 0.07, tTwist = 0.55, tLight = 0.7, tLean = 0;
      if (st === "connecting") { tSpin = 1.4; tFlow = 0.32; tTwist = 0.95; tLight = 0.9; }
      else if (st === "listening") { tSpin = 0.16; tFlow = 0.08; tTwist = 0.6; tLight = 0.85 + lvlIn * 0.7; tLean = lvlIn; }
      else if (st === "thinking") { tSpin = 0.32; tFlow = -0.42; tTwist = 0.95; tLight = 0.85; }
      else if (st === "speaking") { tSpin = 0.2 + lvlOut * 1.3; tFlow = 0.1 + lvlOut * 0.25; tTwist = 0.62 + lvlOut * 0.45; tLight = 0.95 + lvlOut * 0.8; }
      step(spin, tSpin, dt, 8, 0.8);
      step(flow, tFlow, dt, 10, 0.75);
      step(twist, tTwist, dt, 9, 0.6);
      step(light, tLight, dt, 30, 0.55);
      step(lean, tLean, dt, 40, 0.5);
      step(pulse, stress, dt, 120, 0.45);

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

      // soft contact shadow on the enamel, smaller as it rises
      {
        const sy = H / 2 + W * 0.315;
        const r = W * (0.21 - bob * 0.6);
        ctx.save();
        ctx.translate(W / 2, sy);
        ctx.scale(1, 0.16);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, "rgba(20,60,82,0.085)");
        g.addColorStop(1, "rgba(20,60,82,0)");
        ctx.fillStyle = g;
        ctx.globalAlpha = 1 - bob * 4;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.restore();
      }

      // cube list: N cycling cubes (index 0..N-1), the inner rim of the shell (N), the shell (N+1)
      for (let k = 0; k < N; k++) {
        const u = (k + phase) / N;
        const pul = 1 + Math.max(0, pulse.x) * 0.3 * Math.sin(Math.PI * Math.min(1, u * 1.15));
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
      cubeU[N + 1] = 1; cubeS[N + 1] = 1 + Math.max(0, pulse.x) * 0.035; cubeA[N + 1] = 1;

      const twistOf = (c: number) => (c >= N ? 0 : fold * Math.min(1 - cubeU[c], 0.5) * 1.9);
      const widthOf = (c: number) =>
        c === N + 1 ? Math.max(1.7, unit * 1.3) : c === N ? Math.max(0.8, unit * 0.6) : Math.max(0.75 + 0.6 * cubeU[c], unit * (0.35 + 0.6 * cubeU[c]));
      const coreOf = (c: number) =>
        c >= N ? 0.55 + 0.35 * lk : (0.25 + 0.55 * cubeU[c]) * (0.7 + 0.3 * lk) + lvlOut * (1 - cubeU[c]) * 1.2 + Math.max(0, pulse.x) * 0.9;

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
        strokeEdges(back, a * 0.55, widthOf(c) * 0.85, coreOf(c) * 0.6);
      }

      // the voice, a cool light deep inside the ice
      if (lvlOut > 0.01 || lean.x > 0.01) {
        const r = px * 0.75;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, "rgba(255,255,255,0.9)");
        g.addColorStop(0.35, "rgba(150,210,235,0.35)");
        g.addColorStop(1, "rgba(150,210,235,0)");
        ctx.fillStyle = g;
        ctx.globalAlpha = Math.min(1, lvlOut * 0.55 + lean.x * 0.15);
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
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
        strokeEdges(dimP, a, w, core * 0.75);
        strokeEdges(litP, a, w * 1.1, core * 1.35);

        if (c === N + 1) {
          // frost along the shell's edges and corners
          const f0 = new Path2D(), f1 = new Path2D(), f2 = new Path2D();
          const fb = new Path2D();
          const s = 1;
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
          const fw = Math.max(0.9, unit * 0.8);
          const fl = 0.75 + 0.25 * Math.min(1, lk);
          ctx.strokeStyle = "rgb(46,124,162)";
          ctx.lineWidth = fw * 1.8;
          ctx.globalAlpha = 0.1;
          ctx.stroke(f2);
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = fw * 1.3;
          ctx.globalAlpha = 0.22 * fl;
          ctx.stroke(f0);
          ctx.lineWidth = fw;
          ctx.globalAlpha = 0.45 * fl;
          ctx.stroke(f1);
          ctx.lineWidth = fw * 0.8;
          ctx.globalAlpha = 0.8 * fl;
          ctx.stroke(f2);
          ctx.globalAlpha = 0.18;
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
