/** Camera frames for the agent: the Reolink hub through the bridge, or the laptop webcam as a fallback. */

let webcam: HTMLVideoElement | null = null;

async function webcamFrame(): Promise<HTMLVideoElement> {
  // HACK(demo): without a Reolink hub the laptop webcam stands in for the fridge camera.
  if (!webcam) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    webcam = document.createElement("video");
    webcam.muted = true;
    webcam.playsInline = true;
    webcam.srcObject = stream;
    await webcam.play();
    await new Promise((r) => setTimeout(r, 400)); // let exposure settle
  }
  return webcam;
}

async function hubFrame(channel: number): Promise<HTMLImageElement> {
  const res = await fetch(`/api/camera/${channel}.jpg?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Camera ${channel}: ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Downscaled JPEG data URL. Realtime messages go over a WebRTC data channel, which caps message size. */
function encode(source: CanvasImageSource, w: number, h: number, maxBytes: number): string {
  for (const [side, quality] of [
    [1024, 0.72],
    [800, 0.62],
    [640, 0.55],
  ]) {
    const scale = Math.min(1, side / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length + 400 < maxBytes) return url;
  }
  throw new Error("The camera frame is too large to send.");
}

export async function grabFrames(channels: number[], maxBytes: number): Promise<string[]> {
  if (channels.length) {
    const frames = await Promise.allSettled(channels.map(hubFrame));
    const ok = frames.flatMap((f) => (f.status === "fulfilled" ? [f.value] : []));
    if (ok.length) return ok.map((img) => encode(img, img.naturalWidth, img.naturalHeight, maxBytes));
  }
  const video = await webcamFrame();
  return [encode(video, video.videoWidth, video.videoHeight, maxBytes)];
}
