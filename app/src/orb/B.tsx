import { useEffect, useRef } from "react";
import { FRAG, VERT } from "./b/shader";
import type { OrbVariantProps } from "./types";

/**
 * Orb B: a raymarched ice tesseract. A clear bevelled ice cube with a tesseract frozen inside it,
 * turning through its fourth dimension so the inner cube folds out through the outer one and back,
 * with smaller copies receding inside. Raw WebGL2, one full-screen quad, one fragment shader.
 */

// Render resolution relative to CSS pixels (times min(DPR, 1.25)). CSS upscales the canvas.
const QUALITY = 0.8;
const MIN_SCALE = 0.45;

const S0 = 0.3; // scale of the main tesseract (outer cell ~ the ice body)
const RATIO = 0.44; // nested scale step (= inner/outer cell ratio of the projection)
const D4 = 2.6; // 4D camera distance for the w-perspective

type Targets = { spin: number; light: number; refr: number };
const TARGETS: Record<string, Targets> = {
  off: { spin: 0.16, light: 0.0, refr: 0.0 },
  connecting: { spin: 1.1, light: 0.6, refr: 0.3 },
  listening: { spin: 0.24, light: 0.3, refr: 0.1 },
  thinking: { spin: 0.34, light: 0.35, refr: 0.2 },
  speaking: { spin: 0.3, light: 0.45, refr: 0.25 },
};

const ease = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

export default function OrbB({ status, levels }: OrbVariantProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    // A fresh canvas per mount: StrictMode remounts, and a lost context sticks to its canvas.
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%;display:block";
    hostRef.current!.appendChild(canvas);
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: "high-performance" });
    if (!gl) {
      console.error("orb B: WebGL2 unavailable");
      canvas.remove();
      return;
    }
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error("orb B shader:", gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error("orb B link:", gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    const U = {
      res: u("uRes"), time: u("uTime"), v: u("uV"), s: u("uS"), w: u("uW"), rot: u("uRot"),
      pos: u("uPos"), light: u("uLight"), voice: u("uVoice"), refr: u("uRefr"),
    };
    gl.clearColor(0, 0, 0, 0);

    let scale = Math.min(window.devicePixelRatio || 1, 1.25) * QUALITY;
    let cssW = 1, cssH = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      cssW = Math.max(1, r.width);
      cssH = Math.max(1, r.height);
      canvas.width = Math.round(cssW * scale);
      canvas.height = Math.round(cssH * scale);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const verts = new Float32Array(48);
    const rot = new Float32Array(9);
    let inL = 0, outL = 0; // smoothed levels
    let spin = TARGETS.off.spin, light = 0, refr = 0, lean = 0, pulse = 0;
    let phase = 0, zoom = 0, yaw = 0.6;
    let raf = 0;
    let last = performance.now();
    let slow = 0, fast = 0; // adaptive resolution counters

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const st = statusRef.current;
      const tg = TARGETS[st] ?? TARGETS.off;
      const lv = levels();
      const inT = st === "listening" ? Math.min(1, lv.input * 1.4) : 0;
      const outT = st === "speaking" ? Math.min(1, lv.output * 1.4) : 0;
      inL = ease(inL, inT, dt, inT > inL ? 0.06 : 0.25);
      outL = ease(outL, outT, dt, outT > outL ? 0.06 : 0.25);

      spin = ease(spin, tg.spin + outL * 1.3, dt, 0.5);
      light = ease(light, tg.light + inL * 0.9 + outL * 1.1, dt, 0.12);
      refr = ease(refr, tg.refr + outL * 0.8, dt, 0.15);
      lean = ease(lean, inL, dt, 0.18);
      pulse = ease(pulse, outL, dt, 0.07);
      phase += dt * spin;
      yaw += dt * (0.09 + spin * 0.15);
      // thinking: the nested cubes cycle inward; otherwise settle on the next whole step
      if (st === "thinking") zoom += dt * 0.42;
      else zoom = ease(zoom, Math.ceil(zoom - 1e-3), dt, 0.5);

      // the 16 vertices, rotated in XW, YW, ZW, then perspective-projected from w
      const a = phase, b = phase * 0.61 + 0.7 * Math.sin(t * 0.21), c = phase * 0.37 + 0.4;
      const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
      for (let i = 0; i < 16; i++) {
        let x = i & 1 ? 1 : -1, y = i & 2 ? 1 : -1, z = i & 4 ? 1 : -1, w = i & 8 ? 1 : -1;
        let tmp = ca * x - sa * w; w = sa * x + ca * w; x = tmp;
        tmp = cb * y - sb * w; w = sb * y + cb * w; y = tmp;
        tmp = cc * z - sc * w; w = sc * z + cc * w; z = tmp;
        const k = D4 / (D4 - w);
        verts[i * 3] = x * k;
        verts[i * 3 + 1] = y * k;
        verts[i * 3 + 2] = z * k;
      }
      const f = zoom - Math.floor(zoom);
      const grow = 1 + pulse * 0.16;
      const s = [0, 1, 2, 3].map((k) => S0 * grow * Math.pow(RATIO, k - 1 + f));

      // body: slow tumble, bob, lean toward the viewer with the mic
      const pitch = 0.52 + 0.05 * Math.sin(t * 0.37) - lean * 0.12;
      const roll = 0.08 * Math.sin(t * 0.29);
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      // R = Ry(yaw) * Rx(pitch) * Rz(roll), column-major
      const m = [
        [cy, 0, sy], [0, 1, 0], [-sy, 0, cy],
      ];
      const rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
      const rz = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
      const mul = (A: number[][], Bm: number[][]) => A.map((row) => [0, 1, 2].map((j) => row[0] * Bm[0][j] + row[1] * Bm[1][j] + row[2] * Bm[2][j]));
      const Rm = mul(mul(m, rx), rz);
      for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) rot[col * 3 + row] = Rm[row][col];

      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.time, t);
      gl.uniform3fv(U.v, verts);
      gl.uniform4f(U.s, s[0], s[1], s[2], s[3]);
      const wt = (d: number) => (d < 0 ? (1 + d) * (1 + d) * (1 - 2 * d) : Math.pow(0.6, d) * Math.min(1, Math.max(0, (2.1 - d) / 0.9)));
      gl.uniform4f(U.w, wt(f - 1), wt(f), wt(f + 1), wt(f + 2));
      gl.uniformMatrix3fv(U.rot, false, rot);
      gl.uniform3f(U.pos, 0.025 * Math.sin(t * 0.53), 0.06 * Math.sin(t * 0.8) + 0.02, lean * 0.35);
      gl.uniform1f(U.light, light);
      gl.uniform1f(U.voice, pulse);
      gl.uniform1f(U.refr, refr);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // crude adaptive resolution: drop when frames run slow, recover slowly
      if (dt > 0.024) slow++;
      else if (dt < 0.018) fast++;
      if (slow > 30 && scale > MIN_SCALE) { scale = Math.max(MIN_SCALE, scale * 0.85); slow = fast = 0; resize(); }
      if (fast > 600 && scale < Math.min(window.devicePixelRatio || 1, 1.25) * QUALITY) { scale = Math.min(Math.min(window.devicePixelRatio || 1, 1.25) * QUALITY, scale / 0.9); slow = fast = 0; resize(); }
      if (slow + fast > 900) slow = fast = 0;

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [levels]);

  return <div ref={hostRef} aria-hidden style={{ width: "100%", height: "100%" }} />;
}
