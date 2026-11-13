/**
 * The kitchen stream inset: large in A and B, then faded out for good when the door closes. It stays mounted
 * (opacity 0) once it's gone, because its audio can stay on. Owned by part 1, sub-task 1.
 *
 * Audio: muted by default, and the audience hears the actor through the relay's kitchen mic. U turns the
 * inset's own mic on instead (the camera's or the phone's) and mutes the relay's kitchen channel (relay.ts),
 * so the actor is never heard twice. Coldex always comes through the relay.
 *
 * The source comes from `?kitchen=<source>` on the stage URL, else `VITE_KITCHEN_ROOM`:
 * - `reolink` (camera 0) or `reolink1` (camera 1): the Reolink stream with its mic, through go2rtc
 *   (`infra/go2rtc.sh`, `infra/go2rtc.yaml`: HTTP-FLV first, the RTSP sub stream as fallback). go2rtc's own
 *   player page plays it in MSE mode, because the camera mic is AAC and WebRTC can't carry that. The app
 *   proxies go2rtc at /go2rtc (vite.config.ts), so the stage reaches it through the tunnel on the same origin,
 *   and this page hides the player's overlay and sets its mute directly.
 * - a VDO.Ninja stream id: the phone inside the fridge, facing out, opens
 *     https://vdo.ninja/?push=<room>&webcam&autostart&videodevice=back&quality=1&maxframerate=30&outboundvideobitrate=2500
 *   which sends its mic too, for U. Add `&audiodevice=0` for video only.
 *   (`videodevice=back` matches the camera label; some Android phones say "rear" instead, see vdo.ninja/devices.
 *   Tap the page once after it starts so it holds its wake lock, and turn auto-lock off.) The stage embeds the
 *   chrome-less viewer. Its incoming audio is muted through the iframe API (`{ mute: true|false }`,
 *   https://docs.vdo.ninja/guides/iframe-api-documentation).
 *   When the shut fridge cuts the phone's Wi-Fi, both sides reconnect by themselves, in roughly 5–15 s from the
 *   network coming back (read from VDO.Ninja's source, not measured). `retry=10` makes the viewer look again
 *   every 10 s, the docs' minimum.
 * - a video path (`.mp4` / `.webm`): a local looping clip instead.
 * - nothing: an empty dark slot, so a call window can be laid over it (the documented fallback).
 */
import { useEffect, useRef, useState } from "react";
import { Recognition } from "./Recognition";

type Size = "large" | "hidden";

function source(): string {
  const param = new URLSearchParams(window.location.search).get("kitchen");
  return (param ?? import.meta.env.VITE_KITCHEN_ROOM ?? "").trim();
}

const isClip = (s: string) => /\.(mp4|webm)(\?.*)?$/i.test(s);
const camera = (s: string) => /^reolink(\d?)$/i.exec(s);

/** The VDO.Ninja stream id when the inset shows the fridge phone, else null (phoneAudio.ts). */
export function phoneRoom(): string | null {
  const s = source();
  return s && !camera(s) && !isClip(s) ? s : null;
}

function viewerUrl(room: string, muted: boolean): string {
  // cleanoutput: no VDO.Ninja chrome or pop-ups. lowlatency: minimal buffering. cover: fill the 16:9 box.
  // retry=10: look for a lost stream again every 10 s (the fridge phone drops off while the door is shut).
  // mutespeaker sets the starting state only; later changes go through postMessage so the iframe never reloads.
  return `https://vdo.ninja/?view=${encodeURIComponent(room)}&cleanoutput&lowlatency&cover&retry=10&mutespeaker=${muted ? 1 : 0}`;
}

export function KitchenInset({ size, muted }: { size: Size; muted: boolean }) {
  const [src] = useState(source);
  const cam = camera(src);
  return (
    <div className="kitchen-inset" data-size={size} data-muted={muted}>
      {!src ? (
        <span className="kitchen-label">Kitchen</span>
      ) : cam ? (
        <Camera stream={`fridge_cam${cam[1] || "0"}`} muted={muted} />
      ) : isClip(src) ? (
        <Clip src={src} muted={muted} />
      ) : (
        <Viewer room={src} muted={muted} />
      )}
      {src ? <Recognition visible={size === "large"} /> : null}
    </div>
  );
}

// Inside go2rtc's player page: no status overlay, no controls, the picture fills the 16:9 box.
const PLAYER_CSS = ".info { display: none !important } video { object-fit: cover; background: #000 }";

/** The Reolink camera through go2rtc's player (MSE, video and the AAC mic). */
function Camera({ stream, muted }: { stream: string; muted: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const url = `/go2rtc/stream.html?src=${encodeURIComponent(stream)}&mode=mse`;

  // Same origin through the proxy, so the player can be reached directly. Re-applied every second, because
  // the player makes its <video> late, rebuilds it on reconnect (battery cameras sleep), and mutes itself
  // when autoplay with sound is refused.
  useEffect(() => {
    const apply = () => {
      const doc = frame.current?.contentDocument;
      if (!doc?.head) return;
      if (!doc.getElementById("coldex-player")) {
        const style = doc.createElement("style");
        style.id = "coldex-player";
        style.textContent = PLAYER_CSS;
        doc.head.append(style);
      }
      for (const video of doc.querySelectorAll("video")) {
        video.controls = false;
        if (video.muted !== muted) video.muted = muted;
        if (!muted && video.paused) void video.play().catch(() => {});
      }
    };
    apply();
    const t = setInterval(apply, 1000);
    return () => clearInterval(t);
  }, [muted]);

  return <iframe ref={frame} className="kitchen-media" src={url} title="Kitchen camera" allow="autoplay" />;
}

function Viewer({ room, muted }: { room: string; muted: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [url] = useState(() => viewerUrl(room, muted));
  const send = () => frame.current?.contentWindow?.postMessage({ mute: muted }, "*");

  useEffect(send, [muted]);

  return (
    <iframe
      ref={frame}
      className="kitchen-media"
      src={url}
      title="Kitchen stream"
      allow="autoplay; fullscreen"
      onLoad={send}
    />
  );
}

/** HACK(demo): a local clip in place of the live stream, for dev and as the dead-stream fallback. */
function Clip({ src, muted }: { src: string; muted: boolean }) {
  return <video className="kitchen-media" src={src} autoPlay loop playsInline muted={muted} />;
}
