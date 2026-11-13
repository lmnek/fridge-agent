import type { Status } from "../../realtime";
import { rgba, type Palette, type RGB } from "./palette";

/**
 * The C orb's life while awake: depth colour through the nested cubes, waves of light that travel
 * through the shells (outward on Coldex's stressed syllables, inward and slow while thinking), and a few
 * bright tracers gliding along the cube edges plus a highlight sweeping across the shell. Everything is
 * scaled by `active` (0 idle .. 1 awake), so idle stays calm. Fixed pools, no allocation per frame.
 *
 * Depth coordinate `d`: 0 = the centre, 1 = the outer shell (a cycling cube's `u`).
 */

const MAX_WAVES = 5;
const MAX_TR = 6;
const WAVE_W = 0.13; // gaussian half-width of a wave in depth units

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createLife(EDGES: number[][], N: number) {
  // vertex -> the 3 edges meeting there
  const vEdges: number[][] = Array.from({ length: 8 }, () => []);
  EDGES.forEach((E, e) => { vEdges[E[0]].push(e); vEdges[E[1]].push(e); });
  const other = (e: number, v: number) => (EDGES[e][0] === v ? EDGES[e][1] : EDGES[e][0]);

  // waves: pos in depth units, v = depth units / s (negative runs inward), amp 0..1
  const wPos = new Float32Array(MAX_WAVES), wV = new Float32Array(MAX_WAVES), wAmp = new Float32Array(MAX_WAVES);
  // tracers: cube, edge, start vertex, head param s on the edge, previous edge/start vertex, speed, length, age, life
  const tC = new Int8Array(MAX_TR), tE = new Int8Array(MAX_TR), tV = new Int8Array(MAX_TR);
  const tPE = new Int8Array(MAX_TR).fill(-1), tPV = new Int8Array(MAX_TR);
  const tS = new Float32Array(MAX_TR), tSp = new Float32Array(MAX_TR), tLen = new Float32Array(MAX_TR);
  const tAge = new Float32Array(MAX_TR), tLife = new Float32Array(MAX_TR).fill(0);

  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  let act = 0, armed = true, sinceWave = 9, thinkClock = 0, trAcc = 0, sweep = 0, sweepAmp = 0, voice = 0, t = 0;
  const bodyRgb: RGB = [0, 0, 0], coreRgb: RGB = [0, 0, 0];

  const spawnWave = (pos: number, v: number, amp: number) => {
    let slot = 0;
    for (let i = 0; i < MAX_WAVES; i++) if (wAmp[i] <= 0) { slot = i; break; } else if (wAmp[i] < wAmp[slot]) slot = i;
    wPos[slot] = pos; wV[slot] = v; wAmp[slot] = amp;
  };

  const spawnTracer = (speed: number) => {
    for (let i = 0; i < MAX_TR; i++) {
      if (tAge[i] < tLife[i]) continue;
      const r = rnd();
      // mostly the shell, some on the inner rim, a few on the mid cycling cubes
      tC[i] = r < 0.5 ? N + 1 : r < 0.68 ? N : Math.floor(rnd() * N);
      tE[i] = Math.floor(rnd() * 12);
      tV[i] = EDGES[tE[i]][rnd() < 0.5 ? 0 : 1];
      tPE[i] = -1;
      tS[i] = rnd() * 0.3;
      tSp[i] = speed * (0.75 + rnd() * 0.5);
      tLen[i] = 0.32 + rnd() * 0.22;
      tAge[i] = 0;
      tLife[i] = 1.5 + rnd() * 1.3;
      return;
    }
  };

  /** advance everything one frame */
  const frame = (dt: number, now: number, st: Status, activeX: number, lvlOut: number, stress: number, pal: Palette) => {
    t = now;
    act = Math.min(1, Math.max(0, activeX));
    for (let j = 0; j < 3; j++) {
      bodyRgb[j] = pal.body[j] + (pal.deep[j] - pal.body[j]) * 0.5;
      coreRgb[j] = pal.core[j];
    }

    // waves
    for (let i = 0; i < MAX_WAVES; i++) {
      if (wAmp[i] <= 0) continue;
      wPos[i] += wV[i] * dt;
      wAmp[i] *= Math.exp(-dt * 0.35);
      if (wPos[i] > 1.35 || wPos[i] < -0.35) wAmp[i] = 0;
    }
    sinceWave += dt;
    if (st === "speaking") {
      // a stressed syllable launches a wave from the centre; louder = brighter and faster
      if (armed && stress > 0.32 && sinceWave > 0.16) {
        spawnWave(-0.3, 1.0 + lvlOut * 1.6, Math.min(1, 0.45 + stress * 0.55));
        armed = false;
        sinceWave = 0;
      } else if (stress < 0.12) armed = true;
    } else armed = true;
    if (st === "thinking") {
      // slow, regular waves sinking inward, like looking deeper
      thinkClock += dt;
      if (thinkClock > 1.5) { thinkClock = 0; spawnWave(1.3, -0.5, 0.6); }
    } else thinkClock = 1.1;
    voice += (lvlOut - voice) * (1 - Math.exp(-dt / 0.3));

    // tracers
    let rate = 0, speed = 0.5;
    if (st === "speaking") { rate = 0.9 + lvlOut * 2.6; speed = 0.75 + lvlOut * 1.4; }
    else if (st === "thinking") { rate = 0.75; speed = 0.45; }
    else if (st === "listening") { rate = 0.35; speed = 0.35; }
    else if (st === "connecting") { rate = 1.2; speed = 0.9; }
    trAcc += rate * act * dt;
    if (trAcc > 1) { trAcc -= 1 + rnd() * 0.4; spawnTracer(speed); }
    for (let i = 0; i < MAX_TR; i++) {
      if (tAge[i] >= tLife[i]) continue;
      tAge[i] += dt;
      tS[i] += tSp[i] * dt * (st === "speaking" ? 1 + lvlOut * 0.8 : 1);
      if (tS[i] >= 1) {
        // round the corner onto one of the two other edges at this vertex
        const v1 = other(tE[i], tV[i]);
        const opts = vEdges[v1];
        let ne = opts[Math.floor(rnd() * 3)];
        if (ne === tE[i]) ne = opts[(opts.indexOf(ne) + 1) % 3];
        tPE[i] = tE[i]; tPV[i] = tV[i];
        tE[i] = ne; tV[i] = v1;
        tS[i] -= 1;
      }
    }

    // the highlight sweeping across the shell: one pass every few seconds, faster while talking
    sweep += dt * (st === "speaking" ? 0.32 + lvlOut * 0.5 : st === "thinking" ? 0.22 : 0.15);
    if (sweep > 1) sweep -= 1;
    sweepAmp += ((st === "off" ? 0 : st === "speaking" ? 0.55 + voice * 0.45 : 0.4) * act - sweepAmp) * (1 - Math.exp(-dt / 0.5));
  };

  /** summed wave brightness at depth d, 0..1 */
  const waveAt = (d: number) => {
    let s = 0;
    for (let i = 0; i < MAX_WAVES; i++) {
      if (wAmp[i] <= 0) continue;
      const x = (d - wPos[i]) / WAVE_W;
      s += wAmp[i] * Math.exp(-x * x);
    }
    return Math.min(1, s) * act;
  };

  /** edge tone 0 (light body) .. 1 (deep blue): deep inside, light outside, slowly breathing; waves lighten it */
  const toneAt = (d: number) => {
    const depth = 1 - smooth(0.12, 0.92, d);
    const breathe = 0.78 + 0.22 * Math.sin(t * 0.8 - d * 4.2);
    return act * depth * breathe * (1 - 0.75 * waveAt(d));
  };

  /** brightness at the centre, for the inner glow */
  const centre = () => waveAt(0.12);

  // stroke a span [qa, qb] of tracer i (q in [-1, 0] is the previous edge, [0, 1] the current one) as one path,
  // only the parts whose edge faces the wanted way
  const span = (ctx: CanvasRenderingContext2D, i: number, qa: number, qb: number, SX: Float32Array, SY: Float32Array, front: Uint8Array, wantFront: boolean) => {
    let any = false;
    ctx.beginPath();
    if (qa < 0 && tPE[i] >= 0 && !!front[tPE[i]] === wantFront) {
      const v0 = tPV[i], v1 = other(tPE[i], v0);
      const a = 1 + qa, b = 1 + Math.min(0, qb);
      ctx.moveTo(SX[v0] + (SX[v1] - SX[v0]) * a, SY[v0] + (SY[v1] - SY[v0]) * a);
      ctx.lineTo(SX[v0] + (SX[v1] - SX[v0]) * b, SY[v0] + (SY[v1] - SY[v0]) * b);
      any = true;
    }
    if (qb > 0 && !!front[tE[i]] === wantFront) {
      const v0 = tV[i], v1 = other(tE[i], v0);
      const a = Math.max(0, qa), b = Math.min(1, qb);
      if (!any || qa >= 0) ctx.moveTo(SX[v0] + (SX[v1] - SX[v0]) * a, SY[v0] + (SY[v1] - SY[v0]) * a);
      ctx.lineTo(SX[v0] + (SX[v1] - SX[v0]) * b, SY[v0] + (SY[v1] - SY[v0]) * b);
      any = true;
    }
    return any;
  };

  // a point at q along tracer i (q < 0 lies on the previous edge)
  let ptX = 0, ptY = 0;
  const pointAt = (i: number, q: number, SX: Float32Array, SY: Float32Array) => {
    const prev = q < 0 && tPE[i] >= 0;
    const v0 = prev ? tPV[i] : tV[i], v1 = other(prev ? tPE[i] : tE[i], v0);
    const f = prev ? 1 + q : Math.max(0, q);
    ptX = SX[v0] + (SX[v1] - SX[v0]) * f;
    ptY = SY[v0] + (SY[v1] - SY[v0]) * f;
  };

  // a soft streak: transparent tail, bright just behind the head, a short fade in front of it
  const streak = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: RGB, a: number, mid: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, rgba(col, 0));
    g.addColorStop(mid, rgba(col, a * 0.75));
    g.addColorStop(Math.min(0.97, mid + 0.18), rgba(col, a));
    g.addColorStop(1, rgba(col, 0));
    return g;
  };

  /** draw the tracers living on cube c, right after its edges (pass 1: back edges, pass 2: front) */
  const drawTracers = (
    ctx: CanvasRenderingContext2D, c: number, wantFront: boolean, cubeA: number, w: number,
    SX: Float32Array, SY: Float32Array, front: Uint8Array,
  ) => {
    if (act < 0.02) return;
    for (let i = 0; i < MAX_TR; i++) {
      if (tC[i] !== c || tAge[i] >= tLife[i]) continue;
      const k = tAge[i] / tLife[i];
      const env = smooth(0, 0.25, k) * (1 - smooth(0.65, 1, k));
      const a = Math.min(1, env * cubeA * act * (wantFront ? 1 : 0.45));
      if (a < 0.01) continue;
      const len = tLen[i], s = tS[i];
      if (!span(ctx, i, s - len, s + 0.03, SX, SY, front, wantFront)) continue;
      pointAt(i, s - len, SX, SY);
      const x0 = ptX, y0 = ptY;
      pointAt(i, s + 0.03, SX, SY);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = streak(ctx, x0, y0, ptX, ptY, bodyRgb, a, 0.5);
      ctx.lineWidth = w * 5;
      ctx.stroke();
      ctx.strokeStyle = streak(ctx, x0, y0, ptX, ptY, coreRgb, a, 0.6);
      ctx.lineWidth = w * 1.7;
      ctx.stroke();
    }
  };

  /** a band of light crossing the shell diagonally, lighting the lit front edges where it passes */
  const drawSweep = (
    ctx: CanvasRenderingContext2D, w: number, cx: number, cy: number, R: number,
    SX: Float32Array, SY: Float32Array, front: Uint8Array, lit: Float32Array,
  ) => {
    if (sweepAmp < 0.01) return;
    // the band's position along the screen diagonal (upper left to lower right), from beyond one corner to past the other
    const sq = (-1.3 + sweep * 2.6) * R;
    const band = R * 0.2;
    for (let e = 0; e < 12; e++) {
      if (!front[e] || lit[e] < 0.05) continue;
      const E = EDGES[e];
      const x0 = SX[E[0]], y0 = SY[E[0]], x1 = SX[E[1]], y1 = SY[E[1]];
      const q0 = (x0 - cx + y0 - cy) * 0.7071, q1 = (x1 - cx + y1 - cy) * 0.7071;
      const dq = q1 - q0;
      if (Math.abs(dq) < band * 0.6) continue; // edges along the band would flash whole; skip them
      // the band's centre on this edge and its reach either side, faded at both ends by a gradient
      const m = (sq - q0) / dq, half = band / Math.abs(dq);
      if (m + half < 0 || m - half > 1) continue;
      const al = Math.min(1, sweepAmp * (0.3 + lit[e]));
      const a0 = m - half, a1 = m + half;
      const g = ctx.createLinearGradient(x0 + (x1 - x0) * a0, y0 + (y1 - y0) * a0, x0 + (x1 - x0) * a1, y0 + (y1 - y0) * a1);
      g.addColorStop(0, rgba(coreRgb, 0));
      g.addColorStop(0.5, rgba(coreRgb, al));
      g.addColorStop(1, rgba(coreRgb, 0));
      ctx.beginPath();
      ctx.moveTo(x0 + (x1 - x0) * Math.max(0, a0), y0 + (y1 - y0) * Math.max(0, a0));
      ctx.lineTo(x0 + (x1 - x0) * Math.min(1, a1), y0 + (y1 - y0) * Math.min(1, a1));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = g;
      ctx.lineWidth = w * 2;
      ctx.stroke();
    }
  };

  return { frame, waveAt, toneAt, centre, drawTracers, drawSweep, voice: () => voice };
}
