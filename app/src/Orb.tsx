import { useEffect, useRef } from "react";
import type { Status } from "./realtime";

/**
 * The fridge light. Off, it is a cold grey bulb that breathes slowly. Tapped, it switches on.
 * While listening, frost drifts in toward it with your voice. While speaking, the light swells
 * and its edge ripples with the voice, and the frost is pushed outward.
 */
export function Orb({
  status,
  levels,
  onToggle,
}: {
  status: Status;
  levels: () => { input: number; output: number };
  onToggle: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frost = Array.from({ length: 70 }, (_, i) => ({
      a: (i / 70) * Math.PI * 2 + Math.random() * 0.4,
      r: 1.18 + Math.random() * 0.55,
      s: 0.6 + Math.random() * 1.6,
      v: (Math.random() - 0.5) * 0.18,
      phase: Math.random() * Math.PI * 2,
    }));
    let light = 0; // 0 = off, 1 = on
    let level = 0;
    let spin = 0;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const st = statusRef.current;
      const { input, output } = levels();
      const on = st !== "off";
      light += ((on ? 1 : 0) - light) * Math.min(1, dt * 3.2);
      const target = st === "speaking" ? output * 1.5 : st === "listening" ? input * 1.1 : 0;
      level += (Math.min(1, target) - level) * Math.min(1, dt * (target > level ? 14 : 5));
      spin += dt * (st === "connecting" ? 2.4 : st === "thinking" ? 0.9 : 0.12);

      const { width: w, height: h } = canvas.getBoundingClientRect();
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * 0.21;
      const breathe = reduced ? 0 : Math.sin(t * (on ? 1.4 : 0.7)) * 0.018;
      const swell = st === "speaking" ? level * 0.14 : -level * 0.05;
      const r = base * (0.92 + light * 0.08 + breathe + swell);
      ctx.clearRect(0, 0, w, h);

      // spill of light on the enamel around the bulb
      const spill = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, Math.min(w, h) / 2);
      spill.addColorStop(0, `rgba(150, 222, 246, ${0.34 * light + level * 0.18})`);
      spill.addColorStop(1, "rgba(150, 222, 246, 0)");
      ctx.fillStyle = spill;
      ctx.fillRect(0, 0, w, h);

      // frost particles
      for (const p of frost) {
        if (!reduced) p.a += (p.v + (st === "connecting" ? 0.9 : 0.02)) * dt;
        const push = st === "speaking" ? level * 0.5 : st === "listening" ? -level * 0.28 : 0;
        const pr = r * (p.r + push + Math.sin(t * 0.8 + p.phase) * 0.03);
        const x = cx + Math.cos(p.a + spin * 0.2) * pr;
        const y = cy + Math.sin(p.a + spin * 0.2) * pr;
        const alpha = (0.18 + 0.5 * light) * (0.55 + 0.45 * Math.sin(t * 1.3 + p.phase));
        ctx.fillStyle = `rgba(${light > 0.5 ? "70, 150, 190" : "140, 160, 170"}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, p.s * (1 + level * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }

      // the bulb: three layers with rippling edges
      const layers = [
        { k: [3, 5, 7], amp: 1, from: [214, 240, 250], to: [40, 132, 176], alpha: 0.95 },
        { k: [2, 4, 9], amp: 0.7, from: [255, 255, 255], to: [120, 205, 238], alpha: 0.55 },
        { k: [4, 6, 11], amp: 0.5, from: [255, 255, 255], to: [190, 236, 250], alpha: 0.45 },
      ];
      layers.forEach((layer, li) => {
        const lr = r * (1 - li * 0.17);
        const amp = reduced ? 0 : (0.012 + level * 0.11) * layer.amp;
        ctx.beginPath();
        const steps = 96;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          let d = 0;
          layer.k.forEach((k, ki) => {
            d += Math.sin(a * k + t * (0.9 + ki * 0.55) * (li % 2 ? -1 : 1) + spin * (ki + 1)) / (ki + 1);
          });
          const rr = lr * (1 + amp * d);
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const mix = (c: number[], grey: number) => c.map((v) => Math.round(grey + (v - grey) * light));
        const from = mix(layer.from, 236);
        const to = mix(layer.to, 186);
        const g = ctx.createRadialGradient(cx - lr * 0.28, cy - lr * 0.32, lr * 0.05, cx, cy, lr * 1.05);
        g.addColorStop(0, `rgba(${from.join(",")}, ${layer.alpha})`);
        g.addColorStop(1, `rgba(${to.join(",")}, ${layer.alpha})`);
        ctx.fillStyle = g;
        ctx.fill();
      });

      // a cold highlight, like light on a glass shelf
      ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + 0.35 * light})`;
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.3, cy - r * 0.42, r * 0.26, r * 0.1, -0.5, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [levels]);

  const label =
    status === "off" ? "Wake the fridge" : status === "connecting" ? "Waking up" : "Put the fridge to sleep";
  return (
    <button type="button" className="orb" onClick={onToggle} aria-label={label} aria-pressed={status !== "off"}>
      <canvas ref={canvasRef} aria-hidden />
    </button>
  );
}
