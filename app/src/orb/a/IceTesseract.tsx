import { Environment, Lightformer, MeshTransmissionMaterial } from "@react-three/drei";
import { useFrame, useStore } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Status } from "../../realtime";
import type { Levels } from "../types";

/**
 * One knob for weaker hardware (the kitchen tablet): lower `dpr`, `res` and `samples`, or turn off
 * `backside` (the second transmission pass that gives the beams their thickness).
 */
export const QUALITY = {
  dpr: 1.5,
  res: 1024,
  samples: 6,
  backside: true,
  capSegments: 4,
  radialSegments: 12,
};

const PAGE = new THREE.Color("#f3f6f7");
const D = 3; // 4D camera distance for the w projection
const SCALE = 0.47; // world units per tesseract unit
const R0 = 0.05; // beam radius at f = 1

// The 16 corners of the hypercube and its 32 edges (corners differing in exactly one coordinate).
const VERTS = Array.from({ length: 16 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
const EDGES: [number, number][] = [];
// The 24 squares: pick two free axes, fix the other two; corners listed in winding order.
const FACES: number[][] = [];
for (let a = 0; a < 4; a++)
  for (let b = a + 1; b < 4; b++)
    for (let fixed = 0; fixed < 16; fixed++) {
      if (fixed & ((1 << a) | (1 << b))) continue;
      FACES.push([fixed, fixed | (1 << a), fixed | (1 << a) | (1 << b), fixed | (1 << b)]);
    }
for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) if (!(i & (1 << b))) EDGES.push([i, i | (1 << b)]);

/** A unit capsule, split into the half that follows end A and the half that follows end B. */
function capsuleTemplate() {
  const h = 0.002;
  const g = new THREE.CapsuleGeometry(1, h, QUALITY.capSegments, QUALITY.radialSegments);
  const p = g.attributes.position;
  const n = p.count;
  const off = new Float32Array(n * 3);
  const side = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const y = p.getY(i);
    side[i] = y > 0 ? 1 : 0;
    const v = new THREE.Vector3(p.getX(i), y > 0 ? y - h / 2 : y + h / 2, p.getZ(i)).normalize();
    off.set([v.x, v.y, v.z], i * 3);
  }
  const index = Array.from(g.index!.array);
  g.dispose();
  return { n, off, side, index };
}

function useTesseractGeometry() {
  return useMemo(() => {
    const t = capsuleTemplate();
    const sg = new THREE.SphereGeometry(1, QUALITY.radialSegments, QUALITY.capSegments * 2 + 2);
    const sph = { n: sg.attributes.position.count, off: sg.attributes.position.array as Float32Array, index: Array.from(sg.index!.array) };
    const total = t.n * EDGES.length + sph.n * 16;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let e = 0; e < EDGES.length; e++) for (const k of t.index) idx.push(k + e * t.n);
    const sBase = t.n * EDGES.length;
    for (let v = 0; v < 16; v++) for (const k of sph.index) idx.push(sBase + k + v * sph.n);
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);

    // The 24 square faces, as separate quads with a per-vertex alpha (outer faces show, inner fade).
    const faces = new THREE.BufferGeometry();
    faces.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FACES.length * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    faces.setAttribute("color", new THREE.BufferAttribute(new Float32Array(FACES.length * 4 * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const fidx: number[] = [];
    for (let q = 0; q < FACES.length; q++) fidx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
    faces.setIndex(fidx);
    faces.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    return { geo, t, sph, faces };
  }, []);
}

// Smoothing helpers: one-pole filters with separate attack and release time constants.
const follow = (cur: number, target: number, dt: number, attack: number, release: number) =>
  cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? attack : release)));
const ease = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

type MTM = THREE.MeshPhysicalMaterial & { chromaticAberration: number; distortion: number };

export function IceTesseract({ status, levels }: { status: Status; levels: Levels }) {
  const { geo, t, sph, faces } = useTesseractGeometry();
  const group = useRef<THREE.Group>(null);
  const mat = useRef<MTM>(null);
  const light = useRef<THREE.PointLight>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  // gl.setSize clears the canvas outside the render loop, so render at once on a resize or the orb blanks
  // while the stage glides it. r3f's own size listener runs first, so this frame has the new size.
  const store = useStore();
  useEffect(() => store.subscribe((st, prev) => st.size !== prev.size && st.advance(performance.now())), [store]);

  const s = useRef({
    time: 0,
    w: { off: 1, connecting: 0, listening: 0, thinking: 0, speaking: 0 } as Record<Status, number>,
    inp: 0,
    out: 0,
    outSlow: 0,
    pulse: 0,
    axw: 0.6,
    ayw: 0.2,
    azw: 0.9,
    yaw: 0.6,
  });

  const tmp = useMemo(
    () => ({
      p: Array.from({ length: 16 }, () => new THREE.Vector3()),
      r: new Float32Array(16),
      f: new Float32Array(16),
      d: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      up: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = s.current;
    st.time += dt;
    const time = st.time;

    // State weights ease toward the current status, so every transition blends.
    for (const k of Object.keys(st.w) as Status[]) st.w[k] = ease(st.w[k], k === statusRef.current ? 1 : 0, dt, 0.55);
    const w = st.w;

    const lv = levels();
    st.inp = follow(st.inp, Math.min(lv.input, 1), dt, 0.06, 0.25);
    st.out = follow(st.out, Math.min(lv.output, 1), dt, 0.06, 0.25);
    st.outSlow = ease(st.outSlow, st.out, dt, 0.4);
    st.pulse = follow(st.pulse, Math.min(Math.max(0, st.out - st.outSlow) * 3.5, 1), dt, 0.05, 0.22);
    const inp = st.inp * w.listening;
    const out = st.out * w.speaking;
    const pulse = st.pulse * w.speaking;

    // 4D turn rates per state (rad/s), blended by weight.
    const calm = w.off + w.listening;
    const rxw = 0.2 * calm + 0.55 * w.connecting + 0.04 * w.thinking + (0.22 + 1.5 * out) * w.speaking;
    const ryw = 0.11 * calm + 0.3 * w.connecting + 0.02 * w.thinking + (0.1 + 0.6 * out) * w.speaking;
    const rzw = 0.07 * calm + 0.25 * w.connecting + 0.62 * w.thinking + (0.12 + 0.9 * out) * w.speaking;
    st.axw += rxw * dt;
    st.ayw += ryw * dt;
    st.azw += rzw * dt;
    st.yaw += (0.09 + 0.12 * w.connecting + 0.05 * w.thinking) * dt;

    const cx = Math.cos(st.axw), sx = Math.sin(st.axw);
    const cy = Math.cos(st.ayw), sy = Math.sin(st.ayw);
    const cz = Math.cos(st.azw), sz = Math.sin(st.azw);
    for (let i = 0; i < 16; i++) {
      let [x, y, z, ww] = VERTS[i];
      [x, ww] = [cx * x - sx * ww, sx * x + cx * ww];
      [y, ww] = [cy * y - sy * ww, sy * y + cy * ww];
      [z, ww] = [cz * z - sz * ww, sz * z + cz * ww];
      // Corners deep in w are the inner cube; the voice pushes them outward on stressed syllables.
      const inner = THREE.MathUtils.clamp(0.5 - ww / 2.4, 0, 1);
      const f = (D / (D - ww)) * (1 + pulse * 0.75 * inner);
      tmp.p[i].set(x * f * SCALE, y * f * SCALE, z * f * SCALE);
      tmp.r[i] = R0 * Math.pow(f, 0.8);
      tmp.f[i] = f;
    }

    // Write every capsule: each vertex rides with its end, offset by the template direction.
    const pos = geo.attributes.position.array as Float32Array;
    const nor = geo.attributes.normal.array as Float32Array;
    const { off, side, n } = t;
    for (let e = 0; e < EDGES.length; e++) {
      const [i0, i1] = EDGES[e];
      const A = tmp.p[i0], B = tmp.p[i1];
      const d = tmp.d.subVectors(B, A).normalize();
      tmp.up.set(Math.abs(d.y) < 0.9 ? 0 : 1, Math.abs(d.y) < 0.9 ? 1 : 0, 0);
      const ax = tmp.a.crossVectors(tmp.up, d).normalize();
      const az = tmp.b.crossVectors(ax, d);
      const base = e * n;
      for (let k = 0; k < n; k++) {
        const ox = off[k * 3], oy = off[k * 3 + 1], oz = off[k * 3 + 2];
        const nx = ax.x * ox + d.x * oy + az.x * oz;
        const ny = ax.y * ox + d.y * oy + az.y * oz;
        const nz = ax.z * ox + d.z * oy + az.z * oz;
        const end = side[k] ? B : A;
        const r = side[k] ? tmp.r[i1] : tmp.r[i0];
        const j = (base + k) * 3;
        pos[j] = end.x + nx * r;
        pos[j + 1] = end.y + ny * r;
        pos[j + 2] = end.z + nz * r;
        nor[j] = nx;
        nor[j + 1] = ny;
        nor[j + 2] = nz;
      }
    }
    // Joint spheres a touch fatter than the beams, so no flat cap ever faces the camera.
    const sBase = t.n * EDGES.length;
    for (let v = 0; v < 16; v++) {
      const P = tmp.p[v], r = tmp.r[v] * 1.1;
      for (let k = 0; k < sph.n; k++) {
        const j = (sBase + v * sph.n + k) * 3;
        const ox = sph.off[k * 3], oy = sph.off[k * 3 + 1], oz = sph.off[k * 3 + 2];
        pos[j] = P.x + ox * r;
        pos[j + 1] = P.y + oy * r;
        pos[j + 2] = P.z + oz * r;
        nor[j] = ox;
        nor[j + 1] = oy;
        nor[j + 2] = oz;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;

    // Faint ice faces: alpha rises with 4D nearness, so the outer cube reads as a solid block.
    let fmin = Infinity, fmax = -Infinity;
    for (let i = 0; i < 16; i++) (fmin = Math.min(fmin, tmp.f[i])), (fmax = Math.max(fmax, tmp.f[i]));
    const fp = faces.attributes.position.array as Float32Array;
    const fc = faces.attributes.color.array as Float32Array;
    const faceA = 0.09 + out * 0.08 + inp * 0.04;
    for (let q = 0; q < FACES.length; q++) {
      for (let c = 0; c < 4; c++) {
        const v = FACES[q][c], P = tmp.p[v];
        const j = q * 4 + c;
        fp.set([P.x, P.y, P.z], j * 3);
        const near = (tmp.f[v] - fmin) / (fmax - fmin + 1e-4);
        fc.set([1, 1, 1, faceA * near * near * near], j * 4);
      }
    }
    faces.attributes.position.needsUpdate = true;
    faces.attributes.color.needsUpdate = true;
    faces.computeVertexNormals();

    // Float, bob, and lean in toward the listener.
    const g = group.current!;
    g.position.y = Math.sin(time * 0.55) * 0.12 + Math.sin(time * 0.23) * 0.05;
    g.position.x = Math.sin(time * 0.31) * 0.06;
    g.position.z = inp * 0.45 + out * 0.15;
    g.rotation.set(0.42 + Math.sin(time * 0.27) * 0.08 - inp * 0.12, st.yaw, Math.sin(time * 0.19) * 0.05);

    // The ice catches more light when it hears you; the voice lights it from inside.
    const m = mat.current!;
    m.envMapIntensity = 1 + inp * 1.4 + out * 2.2 + pulse * 1.5 + w.connecting * 0.5;
    m.chromaticAberration = 0.04 + out * 0.12 + pulse * 0.1;
    m.distortion = 0.06 + out * 0.18;
    m.emissiveIntensity = out * 0.55 + pulse * 0.6 + w.thinking * 0.05;
    light.current!.intensity = 0.6 + w.thinking * 1.2 + out * 9 + pulse * 6;
  });

  return (
    <>
      <Environment resolution={256} frames={1}>
        <color attach="background" args={["#2c4250"]} />
        <Lightformer form="rect" intensity={6} position={[0, 4, 1]} rotation-x={Math.PI / 2} scale={[8, 1.2, 1]} />
        <Lightformer form="rect" intensity={8} position={[2, 3, 3]} rotation-x={Math.PI / 3} scale={[0.6, 4, 1]} />
        <Lightformer form="rect" intensity={2.2} position={[-5, 1, 1]} rotation-y={Math.PI / 2} scale={[4, 0.4, 1]} />
        <Lightformer form="rect" intensity={2.2} position={[5, -1, 1]} rotation-y={-Math.PI / 2} scale={[4, 0.4, 1]} />
        <Lightformer form="rect" intensity={0.5} position={[0, 0, 6]} scale={[5, 5, 1]} color="#f2f8fb" />
        <Lightformer form="rect" intensity={10} position={[-2.5, 2, 4]} rotation-y={0.5} scale={[0.25, 6, 1]} />
        <Lightformer form="ring" intensity={1.5} position={[0, -4, -2]} rotation-x={-Math.PI / 2} scale={3} color="#bfe3f2" />
      </Environment>
      <group ref={group}>
        <mesh geometry={geo} frustumCulled={false}>
          <MeshTransmissionMaterial
            ref={mat as never}
            background={PAGE}
            transmission={1}
            ior={1.31}
            thickness={0.6}
            roughness={0.05}
            resolution={QUALITY.res}
            samples={QUALITY.samples}
            backside={QUALITY.backside}
            backsideThickness={0.4}
            chromaticAberration={0.04}
            anisotropicBlur={0.06}
            distortion={0.06}
            distortionScale={0.35}
            temporalDistortion={0.06}
            color="#ffffff"
            attenuationColor="#1f6f96"
            attenuationDistance={4.5}
            clearcoat={1}
            clearcoatRoughness={0.06}
            emissive="#d8efff"
            emissiveIntensity={0}
          />
        </mesh>
        <mesh geometry={faces} frustumCulled={false} renderOrder={2}>
          <meshPhysicalMaterial
            vertexColors
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
            color="#ffffff"
            roughness={0.08}
            clearcoat={1}
            envMapIntensity={1.6}
          />
        </mesh>
        <pointLight ref={light} position={[0, 0, 0]} color="#e3f4ff" intensity={0.6} distance={0} decay={2} />
      </group>
    </>
  );
}
