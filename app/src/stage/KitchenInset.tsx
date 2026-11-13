/**
 * The kitchen stream inset: large in A and B, small from C on, muted from C on. Owned by part 1, sub-task 1.
 *
 * The source comes from `?kitchen=<room>` on the stage URL, else `VITE_KITCHEN_ROOM`:
 * - a VDO.Ninja room: the kitchen phone opens `https://vdo.ninja/?push=<room>`, and the stage embeds the
 *   chrome-less viewer. Its incoming audio is muted through the iframe API (`{ mute: true|false }`,
 *   https://docs.vdo.ninja/guides/iframe-api-documentation).
 * - a video path (`.mp4` / `.webm`): a local looping clip instead.
 * - nothing: an empty dark slot, so a call window can be laid over it (the documented fallback).
 *
 * The element is always laid out at the large size and scaled down with a transform (stage.css), so the
 * stream never reflows mid-transition.
 */
import { useEffect, useRef, useState } from "react";

type Size = "large" | "small" | "hidden";

function source(): string {
  const param = new URLSearchParams(window.location.search).get("kitchen");
  return (param ?? import.meta.env.VITE_KITCHEN_ROOM ?? "").trim();
}

const isClip = (s: string) => /\.(mp4|webm)(\?.*)?$/i.test(s);

function viewerUrl(room: string, muted: boolean): string {
  // cleanoutput: no VDO.Ninja chrome or pop-ups. lowlatency: minimal buffering. cover: fill the 16:9 box.
  // mutespeaker sets the starting state only; later changes go through postMessage so the iframe never reloads.
  return `https://vdo.ninja/?view=${encodeURIComponent(room)}&cleanoutput&lowlatency&cover&mutespeaker=${muted ? 1 : 0}`;
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
