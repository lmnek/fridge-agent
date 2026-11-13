// Orb D: one fragment shader, one ice cube. A slightly uneven rounded box (sphere traced), refraction in
// and out, Beer-Lambert absorption in a tint the JS eases from grey (idle) to ice blue (awake), Fresnel
// reflection of an analytic studio, frost on the bevels, the milky cloud real ice freezes around its
// centre, a handful of trapped air bubbles, and a light in the core that swells with the voice.

export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 frag;

uniform vec2 uRes;
uniform float uTime;
uniform mat3 uRot;     // body local -> world
uniform vec3 uPos;     // body position
uniform float uSize;   // breathing scale, ~1
uniform vec3 uTint;    // transmitted colour per unit of ice (grey .. ice blue)
uniform vec3 uGlowC;   // core light colour
uniform float uGlow;   // core light strength, 0..~1.5
uniform float uGlowR;  // core light radius
uniform float uSheen;  // edge/catch light, 0..1
uniform float uLite;   // 1 = cheap path

const vec3 B = vec3(0.47, 0.45, 0.46);
const float R = 0.075;
const float ETA = 1.31;

float sdBox(vec3 p) {
  vec3 q = abs(p) - B;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - R;
}
vec3 nBox(vec3 p) {
  vec3 q = max(abs(p) - B, 0.0);
  float l = length(q);
  if (l < 1e-5) { vec3 a = abs(p) - B; return a.x > a.y && a.x > a.z ? vec3(sign(p.x),0,0) : a.y > a.z ? vec3(0,sign(p.y),0) : vec3(0,0,sign(p.z)); }
  return sign(p) * q / l;
}

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

// Studio: light sweep, darker floor, an overhead softbox, a cool rim strip on the left, a soft key behind
// the camera, and two dark flags behind the cube so the refraction has something to bend.
vec3 env(vec3 d) {
  float y = d.y;
  vec3 c = mix(vec3(0.86, 0.90, 0.92), vec3(0.955, 0.968, 0.975), smoothstep(-0.3, 0.6, y));
  c = mix(c, vec3(0.62, 0.70, 0.75), smoothstep(-0.05, -0.8, y));
  c *= 1.0 - 0.22 * exp(-abs(y + 0.04) * 30.0);
  if (d.z < 0.0) {
    float px = d.x / -d.z;
    c *= 1.0 - 0.38 * smoothstep(0.08, 0.02, abs(px - 0.40)) * smoothstep(-0.9, -0.2, y);
    c *= 1.0 - 0.28 * smoothstep(0.05, 0.015, abs(px + 0.55)) * smoothstep(-0.9, -0.2, y);
  }
  if (y > 0.0) {
    vec2 sb = d.xz / y;
    float box = smoothstep(0.75, 0.45, abs(sb.x)) * smoothstep(0.55, 0.3, abs(sb.y + 0.05));
    c += vec3(2.4) * box;
  }
  float rim = smoothstep(-0.5, -0.88, d.x) * smoothstep(0.75, 0.15, abs(y - 0.15));
  c += vec3(0.9) * rim;
  float key = smoothstep(0.78, 0.97, dot(d, normalize(vec3(0.55, 0.35, 0.76))));
  c += vec3(1.4) * key;
  return c;
}

// trapped air: a few tiny bubbles, fixed in the ice
const int NB = 7;
const vec4 BUB[NB] = vec4[NB](
  vec4( 0.10,  0.06,  0.04, 0.020),
  vec4(-0.08,  0.14, -0.06, 0.013),
  vec4( 0.03, -0.12,  0.12, 0.016),
  vec4(-0.16, -0.04,  0.10, 0.010),
  vec4( 0.18,  0.17, -0.10, 0.011),
  vec4(-0.02,  0.22,  0.15, 0.009),
  vec4( 0.21, -0.09, -0.14, 0.012)
);

// The surface under the cube: a soft contact shadow and the core light thrown down through the ice as a
// caustic pool. Only alpha and a tint, so the page's own background stays the surface.
vec4 floorPool(vec3 roW, vec3 rdW) {
  if (rdW.y > -0.01) return vec4(0.0);
  float y0 = -0.82 * uSize + uPos.y * 0.5;
  float tf = (y0 - roW.y) / rdW.y;
  vec3 f = roW + rdW * tf;
  vec2 d = (f.xz - uPos.xz) / uSize;
  float r2 = dot(d, d);
  float shadow = exp(-r2 * 3.2) * 0.10;
  vec2 cq = d * 5.0;
  float cn = noise(vec3(cq, uTime * 0.35)) * 0.6 + noise(vec3(cq * 2.1, uTime * 0.5 + 4.0)) * 0.4;
  float ridge = pow(1.0 - abs(cn * 2.0 - 1.0), 5.0);
  float pool = exp(-r2 * 2.4) * (0.45 + 0.9 * ridge) * clamp(uGlow, 0.0, 1.4);
  float a = clamp(shadow + pool * 0.32, 0.0, 0.6);
  vec3 c = mix(vec3(0.42, 0.48, 0.52), uGlowC, clamp(pool * 0.32 / max(a, 1e-3), 0.0, 1.0));
  return vec4(c * a, a);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y);
  vec3 roW = vec3(0.0, 0.0, 4.0);
  vec3 rdW = normalize(vec3(uv * 0.35, -1.0));
  mat3 inv = transpose(uRot);
  vec3 ro = inv * (roW - uPos) / uSize;
  vec3 rd = inv * rdW;

  float br = length(B) + R + 0.01;
  float bb = dot(ro, rd), bc = dot(ro, ro) - br * br, h = bb * bb - bc;
  if (h < 0.0) { frag = floorPool(roW, rdW); return; }
  h = sqrt(h);
  float t = -bb - h, tEnd = -bb + h;
  bool hit = false;
  for (int i = 0; i < 48; i++) {
    float d = sdBox(ro + rd * t);
    if (d < 0.0005) { hit = true; break; }
    t += d;
    if (t > tEnd) break;
  }
  if (!hit) { frag = floorPool(roW, rdW); return; }

  vec3 p = ro + rd * t;
  vec3 n = nBox(p);
  float cosi = clamp(dot(-rd, n), 0.0, 1.0);

  // frost: thick on the bevels and corners, a faint sandblasted haze on the faces
  vec3 q = abs(p) - B;
  float second = max(min(q.x, q.y), min(max(q.x, q.y), q.z));
  float third = min(q.x, min(q.y, q.z));
  float edge = smoothstep(-0.06, 0.0, second);
  float corner = smoothstep(-0.10, 0.0, third);
  float fn = noise(p * 16.0) * 0.6 + noise(p * 43.0) * 0.4;
  float frost = clamp(edge * smoothstep(0.3, 0.75, fn) * 0.65 + corner * 0.3 + smoothstep(0.55, 0.9, fn) * 0.08, 0.0, 1.0);
  // melt: the faces are not optically flat
  vec3 nw = normalize(n + (vec3(noise(p * 4.0), noise(p * 4.0 + 7.1), noise(p * 4.0 + 3.7)) - 0.5) * 0.07);

  float F = 0.03 + 0.97 * pow(1.0 - cosi, 5.0);
  vec3 refl = env(uRot * reflect(rd, nw));

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
  vec3 r2 = refract(r1, -n2, ETA);
  float tir = 0.0;
  if (dot(r2, r2) < 0.5) { r2 = reflect(r1, -n2); tir = 1.0; }
  vec3 trans = env(uRot * r2) * (tir > 0.5 ? 0.7 : 1.0);
  // dispersion: one exit ray per channel, spreading most at the grazing exits near the bevels
  if (uLite < 0.5 && tir < 0.5) {
    vec3 rR = refract(r1, -n2, ETA * 0.975), rB = refract(r1, -n2, ETA * 1.025);
    if (dot(rR, rR) > 0.5 && dot(rB, rB) > 0.5) trans = vec3(env(uRot * rR).r, trans.g, env(uRot * rB).b);
  }
  trans *= pow(uTint, vec3(L * 2.2));

  // the milky core: air frozen out towards the middle, densest at the centre, feathered by noise
  float cloud = 0.0, glowAcc = 0.0;
  int steps = uLite > 0.5 ? 4 : 16;
  float ds = L / float(steps);
  for (int i = 0; i < 16; i++) {
    if (i >= steps) break;
    vec3 s = pi + r1 * (ds * (float(i) + 0.5));
    float r2c = dot(s * vec3(1.0, 1.25, 1.0), s * vec3(1.0, 1.25, 1.0));
    float dens = exp(-r2c * 9.0) * smoothstep(0.25, 0.75, noise(s * 7.0 + 1.3) * 0.7 + noise(s * 17.0) * 0.3);
    cloud += dens * ds;
    glowAcc += exp(-dot(s, s) / (uGlowR * uGlowR)) * ds;
  }
  float milk = 1.0 - exp(-cloud * 9.0);
  vec3 col = mix(trans, mix(vec3(0.93, 0.95, 0.96), uGlowC, 0.25) * (0.92 + 0.5 * uGlow), milk * 0.75);

  // the light in the core, glowing through the cloud and blooming a little past it
  float m = length(pi + r1 * clamp(-dot(pi, r1), 0.0, L));
  float core = exp(-m * m / (uGlowR * uGlowR));
  col = mix(col, col * uTint, uGlow * core * 0.5);
  col += uGlowC * min(uGlow, 0.9) * (core * 0.2 + glowAcc * 0.38 / uGlowR * (0.4 + milk));

  // soft rays from the core when it is loud
  if (uLite < 0.5 && uGlow > 0.5) {
    vec3 mp = pi + r1 * clamp(-dot(pi, r1), 0.0, L);
    vec3 md = normalize(mp + 1e-4);
    float rays = noise(md * 6.0 + vec3(0.0, uTime * 0.25, 0.0));
    rays = smoothstep(0.45, 0.9, rays) * exp(-m * 3.2) * smoothstep(0.5, 1.2, uGlow);
    col += uGlowC * rays * 0.2;
  }

  // bubbles: a bright rim and a darker belly where the chord grazes each one
  if (uLite < 0.5) {
    for (int i = 0; i < NB; i++) {
      vec3 c = BUB[i].xyz;
      float rb = BUB[i].w;
      vec3 w0 = pi - c;
      float sc = clamp(-dot(w0, r1), 0.0, L);
      float d = length(w0 + r1 * sc) / rb;
      col = mix(col, col * 0.78, smoothstep(1.0, 0.6, d) * 0.6);
      col += vec3(1.0) * smoothstep(1.15, 0.95, d) * smoothstep(0.55, 0.9, d) * 0.45;
    }
  }

  // grazing angles darken along the bevels, like thick glass
  col = mix(col, col * uTint * 0.7, edge * smoothstep(0.55, 0.15, cosi) * 0.45);

  col = col * (1.0 - F) + refl * F * (1.0 + 0.4 * uSheen);
  vec3 rw = uRot * reflect(rd, n);
  col += vec3(1.0) * pow(max(dot(rw, normalize(vec3(0.0, 1.0, 0.15))), 0.0), 40.0) * edge * (0.7 + 0.8 * uSheen);
  col += vec3(0.85, 0.93, 1.0) * pow(max(dot(rw, normalize(vec3(-1.0, 0.2, 0.1))), 0.0), 24.0) * edge * 0.5 * (0.5 + uSheen);
  // crisp face speculars that slide as it turns, and a thin bright rim on the bevels
  col += vec3(1.0) * pow(max(dot(rw, normalize(vec3(0.35, 0.9, 0.45))), 0.0), 260.0) * 1.6;
  col += vec3(0.9, 0.96, 1.0) * pow(max(dot(rw, normalize(vec3(-0.6, 0.5, 0.65))), 0.0), 120.0) * 0.7;
  float rim = smoothstep(-0.012, 0.0, second) * smoothstep(0.65, 0.2, cosi);
  col += vec3(0.85, 0.93, 1.0) * rim * (0.35 + 0.4 * uSheen);
  // micro-scratches on the faces
  if (uLite < 0.5) {
    float sc1 = pow(1.0 - abs(noise(p * vec3(90.0, 3.0, 90.0)) * 2.0 - 1.0), 18.0);
    float sc2 = pow(1.0 - abs(noise(p.zxy * vec3(3.0, 80.0, 80.0) + 5.0) * 2.0 - 1.0), 18.0);
    col += vec3(1.0) * (sc1 + sc2) * 0.05;
  }
  col = mix(col, vec3(0.96, 0.975, 0.985), frost * 0.7);

  float a = clamp(0.78 + 0.5 * F + frost * 0.25 + milk * 0.2 + core * uGlow * 0.2, 0.0, 1.0);
  col = min(col, vec3(1.0));
  frag = vec4(col * a, a);
}
`;
