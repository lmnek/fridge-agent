// Orb B: one fragment shader. A bevelled ice cube (rounded-box SDF, sphere traced) with refraction
// in and out, Beer-Lambert ice-blue absorption, Fresnel reflection of an analytic studio, frost on
// the bevels, and a tesseract frozen inside: its 32 edges (16 vertices rotated in 4D and projected
// in JS) are lit analytically along the refracted chord through the ice, at 4 nested scales.

export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 frag;

uniform vec2 uRes;
uniform float uTime;
uniform vec3 uV[16];     // projected tesseract vertices, unit scale
uniform vec4 uS;         // scale of each nested level
uniform vec4 uW;         // weight of each nested level
uniform mat3 uRot;       // body local -> world
uniform vec3 uPos;       // body position
uniform float uLight;    // edge light / catch light, 0..~2
uniform float uVoice;    // smoothed voice, 0..1
uniform float uRefr;     // extra refraction, 0..1

const vec3 B = vec3(0.50);
const float R = 0.085;
const float ETA = 1.31;
const vec3 DEEP = vec3(0.122, 0.435, 0.588);

float sdBox(vec3 p) {
  vec3 q = abs(p) - B;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - R;
}
vec3 nBox(vec3 p) {
  vec3 q = max(abs(p) - B, 0.0);
  float l = length(q);
  if (l < 1e-5) { vec3 a = abs(p); return a.x > a.y && a.x > a.z ? vec3(sign(p.x),0,0) : a.y > a.z ? vec3(0,sign(p.y),0) : vec3(0,0,sign(p.z)); }
  return sign(p) * q / l;
}

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

// Studio: light seamless sweep, darker floor, an overhead softbox, a cool rim strip on the left,
// a soft key behind the camera, and two dark flags behind the cube so refraction has something to bend.
vec3 env(vec3 d) {
  float y = d.y;
  vec3 c = mix(vec3(0.88, 0.93, 0.95), vec3(0.955, 0.972, 0.98), smoothstep(-0.3, 0.6, y));
  c = mix(c, vec3(0.70, 0.84, 0.91), smoothstep(-0.05, -0.8, y));
  c *= 1.0 - 0.16 * exp(-abs(y + 0.04) * 40.0);
  if (d.z < 0.0) {
    float px = d.x / -d.z;
    c *= 1.0 - 0.30 * smoothstep(0.06, 0.015, abs(px - 0.42)) * smoothstep(-0.9, -0.2, y);
    c *= 1.0 - 0.20 * smoothstep(0.04, 0.01, abs(px + 0.58)) * smoothstep(-0.9, -0.2, y);
  }
  if (y > 0.0) {
    vec2 sb = d.xz / y;
    float box = smoothstep(0.75, 0.45, abs(sb.x)) * smoothstep(0.55, 0.3, abs(sb.y + 0.05));
    c += vec3(2.6) * box;
  }
  float rim = smoothstep(-0.5, -0.88, d.x) * smoothstep(0.75, 0.15, abs(y - 0.15));
  c += vec3(0.45, 0.80, 1.15) * rim * 1.3;
  float key = smoothstep(0.75, 0.97, dot(d, normalize(vec3(0.55, 0.35, 0.76))));
  c += vec3(1.6) * key;
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y);
  vec3 roW = vec3(0.0, 0.0, 4.0);
  vec3 rdW = normalize(vec3(uv * 0.40, -1.0));
  mat3 inv = transpose(uRot);
  vec3 ro = inv * (roW - uPos);
  vec3 rd = inv * rdW;

  // bounding sphere early-out
  float br = length(B) + R + 0.01;
  float bb = dot(ro, rd), bc = dot(ro, ro) - br * br, h = bb * bb - bc;
  if (h < 0.0) { frag = vec4(0.0); return; }
  h = sqrt(h);
  float t = -bb - h, tEnd = -bb + h;
  float dmin = 1e9;
  bool hit = false;
  for (int i = 0; i < 48; i++) {
    float d = sdBox(ro + rd * t);
    dmin = min(dmin, d);
    if (d < 0.0005) { hit = true; break; }
    t += d;
    if (t > tEnd) break;
  }
  if (!hit) { frag = vec4(0.0); return; }

  vec3 p = ro + rd * t;
  vec3 n = nBox(p);
  float cosi = clamp(dot(-rd, n), 0.0, 1.0);

  // frost: strongest along the bevels and corners
  vec3 q = abs(p) - B;
  float second = max(min(q.x, q.y), min(max(q.x, q.y), q.z));
  float third = min(q.x, min(q.y, q.z));
  float edge = smoothstep(-0.07, 0.0, second);
  float corner = smoothstep(-0.10, 0.0, third);
  float fn = noise(p * 18.0) * 0.65 + noise(p * 47.0) * 0.35;
  float frost = clamp(edge * smoothstep(0.35, 0.8, fn) * 0.6 + corner * 0.3, 0.0, 1.0);
  // slight surface wobble so the ice is not a perfect glass box
  vec3 nw = normalize(n + (vec3(noise(p * 6.0), noise(p * 6.0 + 7.1), noise(p * 6.0 + 3.7)) - 0.5) * (0.03 + 0.06 * uRefr));

  float F = 0.02 + 0.98 * pow(1.0 - cosi, 5.0);
  vec3 refl = env(uRot * reflect(rd, nw));

  // refract in, march the inside to the exit, refract out
  vec3 r1 = refract(rd, nw, 1.0 / ETA);
  vec3 pi = p - n * 0.002;
  float L = 0.0;
  for (int i = 0; i < 24; i++) {
    float d = -sdBox(pi + r1 * L);
    if (d < 0.001) break;
    L += max(d, 0.003);
  }
  vec3 p2 = pi + r1 * L;
  vec3 n2 = nBox(p2);
  vec3 r2 = refract(r1, -n2, ETA * (1.0 + 0.04 * uRefr));
  float tir = 0.0;
  if (dot(r2, r2) < 0.5) { r2 = reflect(r1, -n2); tir = 1.0; }
  vec3 trans = env(uRot * r2) * (tir > 0.5 ? 0.75 : 1.0);
  vec3 sigma = (vec3(1.0) - DEEP) * 0.42;
  trans *= exp(-sigma * L);

  // the tesseract frozen inside: closest distance from the chord to each edge
  float core = 0.0, halo = 0.0;
  for (int lv = 0; lv < 4; lv++) {
    float w = uW[lv];
    if (w < 0.01) continue;
    float s = uS[lv];
    float wc = mix(0.0032, 0.0062, clamp(s / 0.33, 0.0, 1.0));
    for (int i = 0; i < 16; i++) {
      vec3 a = uV[i] * s;
      for (int k = 0; k < 4; k++) {
        int j = i ^ (1 << k);
        if (j < i) continue;
        vec3 v = uV[j] * s - a;
        vec3 w0 = pi - a;
        float bv = dot(r1, v), cv = dot(v, v), dd = dot(r1, w0), ee = dot(v, w0);
        float den = max(cv - bv * bv, 1e-5);
        float sc = clamp((bv * ee - cv * dd) / den, 0.0, L);
        float tc = clamp((ee + bv * sc) / cv, 0.0, 1.0);
        sc = clamp(bv * tc - dd, 0.0, L);
        vec3 dv = w0 + r1 * sc - v * tc;
        float dist2 = dot(dv, dv);
        float att = w * exp(-sc * 0.8);
        core += att * exp(-dist2 / (wc * wc));
        halo += att * exp(-sqrt(dist2) * 70.0);
      }
    }
  }

  vec3 col = trans;
  col = mix(col, DEEP, clamp(halo * 0.14, 0.0, 0.3));
  col = mix(col, vec3(0.97, 0.99, 1.0), clamp(core * (0.6 + 0.35 * uLight), 0.0, 1.0));
  // thin dark refraction lines only along the bevels at grazing angles
  col = mix(col, DEEP * 0.75, edge * smoothstep(0.55, 0.15, cosi) * 0.4);
  // the voice: a cold light deep in the middle of the ice
  float mid = length(pi + r1 * clamp(-dot(pi, r1), 0.0, L));
  col += vec3(0.55, 0.82, 1.0) * uVoice * 0.45 * exp(-mid * mid * 18.0);

  col = col * (1.0 - F) + refl * F * (1.0 + 0.5 * uLight);
  // white-hot catch light on the bevels from the softbox
  vec3 rw = uRot * reflect(rd, n);
  col += vec3(1.0) * pow(max(dot(rw, normalize(vec3(0.0, 1.0, 0.15))), 0.0), 40.0) * edge * (0.8 + 0.8 * uLight);
  col += vec3(0.75, 0.9, 1.0) * pow(max(dot(rw, normalize(vec3(-1.0, 0.2, 0.1))), 0.0), 24.0) * edge * 0.6 * (0.6 + uLight);
  col = mix(col, vec3(0.97, 0.985, 1.0), frost * 0.7);

  float a = clamp(0.72 + 0.6 * F + frost * 0.25 + core * 0.15, 0.0, 1.0);
  col = min(col, vec3(1.0));
  frag = vec4(col * a, a);
}
`;
