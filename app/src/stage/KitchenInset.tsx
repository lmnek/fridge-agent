/**
 * The kitchen stream inset: large in A and B, then faded out for good when the door closes. Always muted:
 * the audience hears the kitchen through the stage's audio relay, and unmuting this is the relay's fallback,
 * so the element stays mounted (opacity 0) once it's gone. Owned by part 1, sub-task 1.
 *
 * The source comes from `?kitchen=<room>` on the stage URL, else `VITE_KITCHEN_ROOM`:
 * - a VDO.Ninja stream id: the phone inside the fridge, facing out, opens (video only, no mic at all)
 *     https://vdo.ninja/?push=<room>&webcam&autostart&videodevice=back&audiodevice=0&quality=1&maxframerate=30&outboundvideobitrate=2500
 *   (`videodevice=back` matches the camera label; some Android phones say "rear" instead, see vdo.ninja/devices.
 *   Tap the page once after it starts so it holds its wake lock, and turn auto-lock off.) The stage embeds the
 *   chrome-less viewer. Its incoming audio is muted through the iframe API (`{ mute: true|false }`,
 *   https://docs.vdo.ninja/guides/iframe-api-documentation). With `audiodevice=0` there's no call audio to
 *   unmute, so the U fallback only works if the push drops that parameter.
 *   When the shut fridge cuts the phone's Wi-Fi, both sides reconnect by themselves, in roughly 5–15 s from the
 *   network coming back (read from VDO.Ninja's source, not measured). `retry=10` makes the viewer look again
 *   every 10 s, the docs' minimum.
 * - a video path (`.mp4` / `.webm`): a local looping clip instead.
 * - nothing: an empty dark slot, so a call window can be laid over it (the documented fallback).
 *
 */
import { useEffect, useRef, useState } from "react";

type Size = "large" | "hidden";

function source(): string {
  const param = new URLSearchParams(window.location.search).get("kitchen");
  return (param ?? import.meta.env.VITE_KITCHEN_ROOM ?? "").trim();
}

const isClip = (s: string) => /\.(mp4|webm)(\?.*)?$/i.test(s);

function viewerUrl(room: string, muted: boolean): string {
  // cleanoutput: no VDO.Ninja chrome or pop-ups. lowlatency: minimal buffering. cover: fill the 16:9 box.
  // retry=10: look for a lost stream again every 10 s (the fridge phone drops off while the door is shut).
  // mutespeaker sets the starting state only; later changes go through postMessage so the iframe never reloads.
  return `https://vdo.ninja/?view=${encodeURIComponent(room)}&cleanoutput&lowlatency&cover&retry=10&mutespeaker=${muted ? 1 : 0}`;
}

export function KitchenInset({ size, muted }: { size: Size; muted: boolean }) {
  const [src] = useState(source);
  return (
    <div className="kitchen-inset" data-size={size} data-muted={muted}>
      {!src ? (
        <span className="kitchen-label">Kitchen</span>
      ) : isClip(src) ? (
        <Clip src={src} muted={muted} />
      ) : (
        <Viewer room={src} muted={muted} />
      )}
    </div>
  );
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
