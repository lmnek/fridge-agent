import { useEffect, useRef } from "react";
import { FRAG, VERT } from "./d/shader";
import type { OrbVariantProps } from "./types";

/**
 * Orb D (the default since 15:30): one ice cube. Grey and still-cold at rest, it floods ice blue when
 * Coldex wakes, breathes with the voice, and a light in its milky core swells and fades with every
 * syllable while the ice plays between deep and pale blue. Raw WebGL2, one quad, one fragment shader.
 */

// Render resolution in device pixels per CSS pixel: the full DPR (capped at 2), stepped down gently on
// sustained slow frames (2 -> 1.5 -> 1), and only past the last step the lite shader at 0.75.
const DPR_STEPS = [1.5, 1];

type V3 = [number, number, number];
const GREY: V3 = [0.83, 0.85, 0.86];
const ICE: V3 = [0.55, 0.8, 0.95];
const DEEP: V3 = [0.4, 0.63, 0.9];
const PALE: V3 = [0.64, 0.87, 1.0];
const GLOW_IDLE: V3 = [0.9, 0.92, 0.94];
const GLOW_ICE: V3 = [0.5, 0.8, 1.0];

const mix3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const ease = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
type Spring = { x: number; v: number };
function step(s: Spring, target: number, dt: number, k: number, zeta: number) {
  s.v += (k * (target - s.x) - 2 * Math.sqrt(k) * zeta * s.v) * dt;
  s.x += s.v * dt;
}

export default function OrbD({ status, levels }: OrbVariantProps) {
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
      console.error("orb D: WebGL2 unavailable");
      canvas.remove();
      return;
    }
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error("orb D shader:", gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error("orb D link:", gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    const U = {
      res: u("uRes"), time: u("uTime"), rot: u("uRot"), pos: u("uPos"), size: u("uSize"), tint: u("uTint"),
      glowC: u("uGlowC"), glow: u("uGlow"), glowR: u("uGlowR"), sheen: u("uSheen"), lite: u("uLite"),
    };
    gl.clearColor(0, 0, 0, 0);

    // Lighter mode for weak hardware (the tablet): `?orblite`, or the frame-time watchdog below.
    let lite = new URLSearchParams(window.location.search).has("orblite");
    const top = Math.min(window.devicePixelRatio || 1, 2);
    const steps = [top, ...DPR_STEPS.filter((d) => d < top)];
    let level = 0;
    let winFrames = 0, winTime = 0, badWins = 0;
    const resize = () => {
      const scale = lite ? 0.75 : steps[level];
      canvas.width = Math.round(Math.max(1, canvas.clientWidth) * scale);
      canvas.height = Math.round(Math.max(1, canvas.clientHeight) * scale);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    // Resizing clears the canvas after this frame's draw, so redraw at once or it blanks while the stage glides.
    const ro = new ResizeObserver(() => {
      resize();
      cancelAnimationFrame(raf);
      frame(performance.now());
    });
    ro.observe(canvas);

    const rot = new Float32Array(9);
    let inL = 0, outL = 0, talk = 0, active = 0, speakK = 0, glow = 0, lean = 0;
    const size: Spring = { x: 1, v: 0 };
    let yaw = 0.62, raf = 0, last = performance.now();

    const frame = (now: number) => {
      const rawDt = (now - last) / 1000;
      const dt = Math.min(0.05, rawDt);
      last = now;
      // watchdog: 3 s straight under 20 fps (1 s windows, ignoring hitches) steps the resolution down one
      // notch; past the last notch it switches to the lite shader. It never steps back up.
      if (!lite && !document.hidden && rawDt < 0.5) {
        winFrames++;
        winTime += rawDt;
        if (winTime >= 1) {
          badWins = winFrames / winTime < 20 ? badWins + 1 : 0;
          winFrames = 0;
          winTime = 0;
          if (badWins >= 3) {
            badWins = 0;
            if (level < steps.length - 1) level++;
            else lite = true;
            resize();
          }
        }
      }
      const t = now / 1000;
      const st = statusRef.current;
      const lv = levels();

      // levels: fast attack, softer release; listening hears the mic only, speaking hears Coldex only
      const inT = st === "listening" ? Math.min(1, lv.input * 1.3) : 0;
      const outT = st === "speaking" ? Math.min(1, lv.output * 1.3) : 0;
      inL = ease(inL, inT, dt, inT > inL ? 0.05 : 0.22);
      outL = ease(outL, outT, dt, outT > outL ? 0.045 : 0.2);
      talk = ease(talk, outL, dt, 0.16); // the slower colour swing under the syllables
      active = ease(active, st === "off" ? 0 : 1, dt, st === "off" ? 0.9 : 0.45);
      speakK = ease(speakK, st === "speaking" ? 1 : 0, dt, 0.5);
      lean = ease(lean, inL, dt, 0.2);

      // the core light: an ember at rest, it follows the mic while listening, pulses slowly while thinking,
      // and rides the voice while talking
      const glowT =
        st === "off" ? 0.04 + 0.02 * Math.sin(t * 0.9)
        : st === "connecting" ? 0.5
        : st === "listening" ? 0.16 + inL * 0.7
        : st === "thinking" ? 0.3 + 0.18 * Math.sin(t * 2.6)
        : 0.14 + outL * 1.0;
      glow = ease(glow, glowT, dt, glowT > glow ? 0.06 : 0.18);

      // breathing: a slow idle breath, a quicker one while thinking, a springy swell on stressed syllables
      const breath = st === "thinking" ? 0.018 * Math.sin(t * 2.6) : 0.01 * Math.sin(t * 1.05);
      step(size, 1 + breath + outL * 0.075 + inL * 0.035, dt, 140, 0.55);

      const tint = mix3(mix3(GREY, ICE, active), mix3(DEEP, PALE, talk), speakK * 0.85);
      const glowC = mix3(GLOW_IDLE, GLOW_ICE, active);

      // body: a slow turn, a gentle wobble, leaning in toward a voice
      yaw += dt * (0.12 + 0.25 * outL);
      const pitch = 0.5 + 0.05 * Math.sin(t * 0.37) - lean * 0.1;
      const roll = 0.07 * Math.sin(t * 0.29);
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      const ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
      const rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
      const rz = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
      const mul = (A: number[][], Bm: number[][]) => A.map((row) => [0, 1, 2].map((j) => row[0] * Bm[0][j] + row[1] * Bm[1][j] + row[2] * Bm[2][j]));
      const Rm = mul(mul(rx, ry), rz);
      for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) rot[col * 3 + row] = Rm[row][col];

      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.time, t);
      gl.uniformMatrix3fv(U.rot, false, rot);
      gl.uniform3f(U.pos, 0.025 * Math.sin(t * 0.53), 0.05 * Math.sin(t * 0.8) + 0.02, lean * 0.3);
      gl.uniform1f(U.size, size.x);
      gl.uniform3f(U.tint, tint[0], tint[1], tint[2]);
      gl.uniform3f(U.glowC, glowC[0], glowC[1], glowC[2]);
      gl.uniform1f(U.glow, glow);
      gl.uniform1f(U.glowR, 0.1 + 0.12 * Math.min(1, glow));
      gl.uniform1f(U.sheen, active * 0.35 + outL * 0.65 + inL * 0.4);
      gl.uniform1f(U.lite, lite ? 1 : 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
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
