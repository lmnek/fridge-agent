/**
 * HACK(demo): pixels for the ham box. A hidden second VDO.Ninja viewer of the same stream (SDK from a CDN, so no
 * npm install), drawn small and grayscale, then a plain-JS NCC template match at a few scales.
 * Everything here may fail (no SDK, no stream, no template); Recognition then keeps its calibrated box.
 */

export const FW = 160; // the matching frame's width; its height follows the inset's aspect

export type Gray = { w: number; h: number; data: Float32Array };
export type Match = { x: number; y: number; w: number; h: number; score: number }; // frame pixels

const SDK_URL = "https://cdn.jsdelivr.net/npm/@vdoninja/sdk@1.6.2/vdoninja-sdk.js";
const TPL_STORE = "coldex.recog.template";

type SDK = {
  addEventListener: (t: string, f: (e: CustomEvent) => void) => void;
  quickView: (o: Record<string, unknown>) => Promise<unknown>;
  disconnect: () => Promise<void>;
};

let sdkLoad: Promise<new (o: Record<string, unknown>) => SDK> | null = null;
function loadSdk() {
  sdkLoad ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.onload = () => {
      const w = window as unknown as { VDONinja?: new (o: Record<string, unknown>) => SDK };
      if (w.VDONinja) resolve(w.VDONinja);
      else reject(new Error("no VDONinja global"));
    };
    s.onerror = () => reject(new Error("sdk load failed"));
    document.head.append(s);
  });
  return sdkLoad;
}

/** A hidden <video> fed by its own viewer of `streamID`. Call stop() to hang up. */
export function startFeed(streamID: string) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  let sdk: SDK | null = null;
  let stopped = false;
  void loadSdk()
    .then((VDONinja) => {
      if (stopped) return;
      sdk = new VDONinja({ salt: "vdo.ninja" });
      sdk.addEventListener("track", (e) => {
        const { track, streams } = e.detail as { track: MediaStreamTrack; streams: MediaStream[] };
        if (track.kind !== "video") return;
        video.srcObject = streams?.[0] ?? new MediaStream([track]);
        void video.play().catch(() => {});
      });
      return sdk.quickView({ streamID, audio: false, video: true });
    })
    .catch((err) => console.warn("[recog] feed", err));
  return {
    video,
    stop: () => {
      stopped = true;
      void sdk?.disconnect().catch(() => {});
      video.srcObject = null;
    },
  };
}

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

function toGray(w: number, h: number): Gray {
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  return { w, h, data };
}

/** The current frame, cropped like the iframe's `cover` so frame fractions are inset fractions. */
export function grab(video: HTMLVideoElement, fh: number): Gray | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || video.readyState < 2) return null;
  const a = FW / fh;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (vw / vh > a) {
    sw = vh * a;
    sx = (vw - sw) / 2;
  } else {
    sh = vw / a;
    sy = (vh - sh) / 2;
  }
  canvas.width = FW;
  canvas.height = fh;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, FW, fh);
  return toGray(FW, fh);
}

export function crop(f: Gray, x: number, y: number, w: number, h: number): Gray {
  x = Math.round(x); y = Math.round(y); w = Math.max(4, Math.round(w)); h = Math.max(4, Math.round(h));
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = f.data[Math.min(f.h - 1, y + j) * f.w + Math.min(f.w - 1, x + i)];
  return { w, h, data };
}

export function saveTemplate(t: Gray) {
  localStorage.setItem(TPL_STORE, JSON.stringify({ w: t.w, h: t.h, data: Array.from(t.data, Math.round) }));
}

export function loadTemplate(): Gray | null {
  try {
    const t = JSON.parse(localStorage.getItem(TPL_STORE) ?? "");
    if (t?.w && t?.data?.length === t.w * t.h) return { w: t.w, h: t.h, data: Float32Array.from(t.data) };
  } catch {
    /* none */
  }
  return null;
}

/** The starting template from public/demo/ham.jpg, if it exists, scaled to a box of w x h frame pixels. */
export function photoTemplate(w: number, h: number): Promise<Gray | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(toGray(canvas.width, canvas.height));
    };
    img.onerror = () => resolve(null);
    img.src = "/demo/ham.jpg";
  });
}

function resize(t: Gray, s: number): Gray {
  const w = Math.max(4, Math.round(t.w * s));
  const h = Math.max(4, Math.round(t.h * s));
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = t.data[Math.floor((j * t.h) / h) * t.w + Math.floor((i * t.w) / w)];
  return { w, h, data };
}

/** Best normalized cross-correlation of `tpl` in `f` over a few scales. */
export function match(f: Gray, tpl: Gray, scales = [0.85, 1, 1.15]): Match | null {
  // Integral images of the frame and its square, for each window's mean and variance.
  const W = f.w + 1;
  const S = new Float64Array(W * (f.h + 1));
  const Q = new Float64Array(W * (f.h + 1));
  for (let y = 0; y < f.h; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < f.w; x++) {
      const v = f.data[y * f.w + x];
      rs += v;
      rq += v * v;
      S[(y + 1) * W + x + 1] = S[y * W + x + 1] + rs;
      Q[(y + 1) * W + x + 1] = Q[y * W + x + 1] + rq;
    }
  }
  let best: Match | null = null;
  for (const s of scales) {
    const t = resize(tpl, s);
    if (t.w >= f.w || t.h >= f.h) continue;
    const n = t.w * t.h;
    let mean = 0;
    for (const v of t.data) mean += v;
    mean /= n;
    const tz = t.data.map((v) => v - mean);
    let tn = 0;
    for (const v of tz) tn += v * v;
    tn = Math.sqrt(tn);
    if (tn < 1e-3) continue;
    for (let y = 0; y + t.h <= f.h; y++) {
      for (let x = 0; x + t.w <= f.w; x++) {
        const a = y * W + x, b = y * W + x + t.w, c = (y + t.h) * W + x, d = (y + t.h) * W + x + t.w;
        const sum = S[d] - S[b] - S[c] + S[a];
        const sq = Q[d] - Q[b] - Q[c] + Q[a];
        const varf = sq - (sum * sum) / n;
        if (varf < 1e-3) continue;
        let num = 0;
        for (let j = 0; j < t.h; j++) {
          const fo = (y + j) * f.w + x, to = j * t.w;
          for (let i = 0; i < t.w; i++) num += tz[to + i] * f.data[fo + i];
        }
        const score = num / (tn * Math.sqrt(varf));
        if (!best || score > best.score) best = { x, y, w: t.w, h: t.h, score };
      }
    }
  }
  return best;
}
