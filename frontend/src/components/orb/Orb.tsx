import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "alert";

type RGB = [number, number, number];

interface Params {
  energy: number;
  speed: number;
  colors: [RGB, RGB, RGB];
  ripple: number; // poslech: vlny ven
  orbit: number; // přemýšlení: obíhající částice
  wave: number; // řeč: vlnění okraje
}

const GLACIER: RGB = [110, 240, 216];
const SKY: RGB = [90, 169, 255];
const AURORA: RGB = [140, 155, 255];
const ICE: RGB = [170, 250, 255];
const LILAC: RGB = [196, 146, 255];
const APRICOT: RGB = [255, 176, 112];
const TOMATO: RGB = [255, 111, 97];
const BUTTER: RGB = [255, 214, 107];

const TARGETS: Record<OrbState, Params> = {
  idle: { energy: 0.35, speed: 0.32, colors: [GLACIER, SKY, AURORA], ripple: 0, orbit: 0, wave: 0 },
  listening: { energy: 0.75, speed: 0.7, colors: [ICE, GLACIER, SKY], ripple: 1, orbit: 0, wave: 0.2 },
  thinking: { energy: 0.55, speed: 1.35, colors: [AURORA, LILAC, SKY], ripple: 0, orbit: 1, wave: 0 },
  speaking: { energy: 0.7, speed: 0.75, colors: [GLACIER, APRICOT, AURORA], ripple: 0, orbit: 0, wave: 1 },
  alert: { energy: 0.85, speed: 0.95, colors: [APRICOT, TOMATO, BUTTER], ripple: 1, orbit: 0, wave: 0.4 },
};

const LABEL: Record<OrbState, string> = {
  idle: "Frida je v klidu",
  listening: "Frida poslouchá",
  thinking: "Frida přemýšlí",
  speaking: "Frida mluví",
  alert: "Frida tě volá",
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpRGB = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function clone(p: Params): Params {
  return { ...p, colors: [p.colors[0], p.colors[1], p.colors[2]] };
}

export interface OrbProps {
  state: OrbState;
  /** 0..1 okamžitá hlasitost / pulz řeči */
  level?: number;
  className?: string;
  /** poměr poloměru koule k menší straně plátna */
  scale?: number;
}

/** Frida: živá koule ze studeného světla, kreslená na canvas. */
export function Orb({ state, level = 0, className, scale = 0.3 }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  const reduce = useReducedMotion();
  stateRef.current = state;
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const cur = clone(TARGETS[stateRef.current]);
    let pulse = 0;
    let last = performance.now();
    let t = Math.random() * 100;
    let raf = 0;
    let visible = true;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = TARGETS[stateRef.current];
      const k = 1 - Math.exp(-dt * 3.2);
      cur.energy = lerp(cur.energy, target.energy, k);
      cur.speed = lerp(cur.speed, target.speed, k);
      cur.ripple = lerp(cur.ripple, target.ripple, k);
      cur.orbit = lerp(cur.orbit, target.orbit, k);
      cur.wave = lerp(cur.wave, target.wave, k);
      cur.colors = [
        lerpRGB(cur.colors[0], target.colors[0], k),
        lerpRGB(cur.colors[1], target.colors[1], k),
        lerpRGB(cur.colors[2], target.colors[2], k),
      ];
      pulse = lerp(pulse, levelRef.current, 1 - Math.exp(-dt * (levelRef.current > pulse ? 18 : 5)));
      t += dt * (0.4 + cur.speed);
      render(ctx, w, h, dpr, t, cur, pulse, scale);
    };

    const loop = (now: number) => {
      if (visible && document.visibilityState === "visible") draw(now);
      else last = now;
      raf = requestAnimationFrame(loop);
    };

    let io: IntersectionObserver | null = null;
    if (reduce) {
      // bez animace: jeden snímek pro každý stav
      const still = () => {
        const tgt = clone(TARGETS[stateRef.current]);
        render(ctx, w, h, dpr, 12, tgt, 0, scale);
      };
      still();
      const id = window.setInterval(still, 500);
      return () => {
        window.clearInterval(id);
        ro.disconnect();
      };
    }
    io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io?.disconnect();
    };
  }, [reduce, scale]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={LABEL[state]} />;
}

function blobPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, e: number, seed: number) {
  const steps = 72;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const d =
      1 +
      e * 0.09 * Math.sin(3 * a + t * 1.3 + seed) +
      e * 0.06 * Math.sin(5 * a - t * 1.7 + seed * 1.7) +
      0.03 * Math.sin(2 * a + t * 0.6 + seed * 0.3);
    const px = x + Math.cos(a) * r * d;
    const py = y + Math.sin(a) * r * d;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function render(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  t: number,
  p: Params,
  pulse: number,
  scale: number,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (w < 8 || h < 8) return;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * scale * (1 + pulse * 0.04 + Math.sin(t * 0.9) * 0.012);
  const [c0, c1, c2] = p.colors;

  // 1) halo: studené světlo, které z Fridy prosvítá do okolí
  // vnější poloměr nesmí přesáhnout plátno, jinak by byl vidět jeho okraj
  const haloR = Math.min(w, h) / 2 - 1;
  const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, haloR);
  halo.addColorStop(0, rgba(c0, 0.3 + p.energy * 0.14 + pulse * 0.12));
  halo.addColorStop(0.4, rgba(c2, 0.1 + p.energy * 0.05));
  halo.addColorStop(1, rgba(c2, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();

  // 2) poslech: vlny ven
  if (p.ripple > 0.02) {
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.55 + i / 3) % 1;
      const rr = R * (1.04 + ph * 0.75);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(c0, (1 - ph) * 0.45 * p.ripple);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // 3) řeč: vlnící se obrys kolem koule
  if (p.wave > 0.02) {
    for (let j = 0; j < 2; j++) {
      ctx.beginPath();
      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const amp = R * (0.025 + pulse * 0.07) * p.wave;
        const rr = R * (1.1 + j * 0.08) + Math.sin(a * 6 + t * (3 + j) + j) * amp + Math.sin(a * 11 - t * 4) * amp * 0.5;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = rgba(j ? c1 : c0, (0.35 - j * 0.15) * p.wave);
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  // 4) tělo koule
  const body = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.1, cx, cy, R);
  body.addColorStop(0, "#143457");
  body.addColorStop(1, "#071425");
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();

  // 5) polární záře uvnitř
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  const blobs: [RGB, number, number, number][] = [
    [c0, 0.82, 0, 0.62],
    [c1, 0.66, 2.1, 0.58],
    [c2, 0.74, 4.2, 0.5],
    [c0, 0.46, 1.3, 0.42],
  ];
  blobs.forEach(([col, size, seed, alpha], i) => {
    const orbitR = R * (0.22 + 0.08 * Math.sin(t * 0.3 + seed));
    const bx = cx + Math.cos(t * (0.35 + i * 0.07) + seed) * orbitR;
    const by = cy + Math.sin(t * (0.42 + i * 0.05) + seed * 1.3) * orbitR * 0.85;
    const br = R * size * (1 + pulse * 0.12);
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, rgba(col, alpha * (0.75 + p.energy * 0.35)));
    g.addColorStop(0.55, rgba(col, alpha * 0.35));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    blobPath(ctx, bx, by, br, t, p.energy, seed);
    ctx.fill();
  });
  // jemný pruh světla, který pomalu rotuje
  ctx.translate(cx, cy);
  ctx.rotate(t * 0.18);
  const band = ctx.createLinearGradient(-R, 0, R, 0);
  band.addColorStop(0, rgba(c1, 0));
  band.addColorStop(0.5, rgba(c1, 0.18 + p.energy * 0.1));
  band.addColorStop(1, rgba(c1, 0));
  ctx.fillStyle = band;
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 1.1, R * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 6) sklo: odlesk nahoře a okraj
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  const spec = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.45, 0, cx - R * 0.32, cy - R * 0.45, R * 0.75);
  spec.addColorStop(0, "rgba(255,255,255,0.32)");
  spec.addColorStop(0.4, "rgba(255,255,255,0.06)");
  spec.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  const rim = ctx.createLinearGradient(cx, cy - R, cx, cy + R);
  rim.addColorStop(0, "rgba(230,250,255,0.55)");
  rim.addColorStop(0.5, rgba(c0, 0.12));
  rim.addColorStop(1, rgba(c1, 0.5));
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 0.6, 0, Math.PI * 2);
  ctx.stroke();

  // spodní odražené světlo
  const bounce = ctx.createRadialGradient(cx, cy + R * 0.85, 0, cx, cy + R * 0.85, R * 0.7);
  bounce.addColorStop(0, rgba(c1, 0.22));
  bounce.addColorStop(1, rgba(c1, 0));
  ctx.fillStyle = bounce;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 7) přemýšlení: částice na nakloněné dráze
  if (p.orbit > 0.02) {
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = t * 1.1 + (i / n) * Math.PI * 2;
      const ex = Math.cos(a) * R * 1.32;
      const ey = Math.sin(a) * R * 0.42;
      const tilt = -0.42;
      const px = cx + ex * Math.cos(tilt) - ey * Math.sin(tilt);
      const py = cy + ex * Math.sin(tilt) + ey * Math.cos(tilt);
      const front = Math.sin(a) > 0;
      const size = (front ? 2.4 : 1.4) * (0.6 + 0.4 * Math.sin(i * 1.7 + t));
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.5, size), 0, Math.PI * 2);
      ctx.fillStyle = rgba(i % 3 === 0 ? c1 : c0, (front ? 0.9 : 0.35) * p.orbit);
      ctx.fill();
    }
  }
}
