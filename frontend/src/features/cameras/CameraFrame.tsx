import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RefreshCw } from "lucide-react";
import { useApp } from "../../store/app";
import type { CameraInfo, Observation } from "../../lib/types";
import { cx } from "../../lib/format";

const LIVE_LIMIT_MS = 235_000; // backend ukončí MJPEG po ~240 s

/** Rámečky detekcí přes obraz (normalizované souřadnice 0..1). */
export function DetectionOverlay({ obs, dim, compact }: { obs: Observation | undefined; dim?: boolean; compact?: boolean }) {
  if (!obs) return null;
  return (
    <div className={cx("pointer-events-none absolute inset-0 transition-opacity duration-500", dim ? "opacity-45" : "opacity-100")}>
      <AnimatePresence>
        {obs.detections.map((d, i) =>
          d.bbox ? (
            <motion.div
              key={`${obs.id}-${i}`}
              initial={{ opacity: 0, scale: 1.08 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.025, duration: 0.35 }}
              className="absolute rounded-[6px] border-[1.5px]"
              style={{
                left: `${d.bbox.x * 100}%`,
                top: `${d.bbox.y * 100}%`,
                width: `${d.bbox.w * 100}%`,
                height: `${d.bbox.h * 100}%`,
                borderColor: d.confidence >= 0.8 ? "rgb(110 240 216 / 0.9)" : "rgb(255 214 107 / 0.9)",
                boxShadow: "0 0 0 1px rgb(7 17 31 / 0.35), 0 0 14px rgb(110 240 216 / 0.25)",
              }}
            >
              {!compact && (
                <span
                  className="absolute -top-[18px] left-[-1.5px] hidden max-w-[180px] items-center gap-1 truncate @min-[540px]:flex rounded-[5px] px-1.5 py-px text-[10px] leading-[15px] font-semibold whitespace-nowrap text-ink"
                  style={{ background: d.confidence >= 0.8 ? "#6ef0d8" : "#ffd66b" }}
                >
                  {d.label}
                  <span className="tabular font-normal opacity-70">{Math.round(d.confidence * 100)} %</span>
                </span>
              )}
            </motion.div>
          ) : null,
        )}
      </AnimatePresence>
    </div>
  );
}

function ChangedRegions({ obs }: { obs: Observation | undefined }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!obs?.changed_regions.length) return;
    setShow(true);
    const t = window.setTimeout(() => setShow(false), 3500);
    return () => window.clearTimeout(t);
  }, [obs?.id, obs?.changed_regions.length]);
  if (!show || !obs) return null;
  return (
    <div className="pointer-events-none absolute inset-0">
      {obs.changed_regions.map((r, i) => (
        <div
          key={i}
          className="absolute animate-pulse rounded-md border-2 border-dashed border-apricot/90 bg-apricot/10"
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
        />
      ))}
    </div>
  );
}

export interface CameraFrameProps {
  camera: CameraInfo;
  live?: boolean;
  boxes?: boolean;
  compact?: boolean;
  className?: string;
}

/** Obraz z kamery v poměru 16:10 (stejný jako snímky), ať rámečky sedí. */
export function CameraFrame({ camera, live = false, boxes = true, compact, className }: CameraFrameProps) {
  const open = useApp((s) => !!s.door[camera.id]);
  const tick = useApp((s) => s.frameTick[camera.id] ?? 0);
  const detected = useApp((s) => s.detected[camera.id]);
  const latest = useApp((s) => s.observations[camera.id]);
  const [nonce, setNonce] = useState(() => Date.now());
  const [ended, setEnded] = useState(false);
  const timer = useRef(0);

  const liveKind = camera.live?.kind;
  const useLive = live && camera.online && !!camera.live && (liveKind === "mjpeg" || liveKind === "webrtc" || liveKind === "mse");

  useEffect(() => {
    if (!useLive || liveKind !== "mjpeg") return;
    setEnded(false);
    timer.current = window.setTimeout(() => setEnded(true), LIVE_LIMIT_MS);
    return () => window.clearTimeout(timer.current);
  }, [useLive, liveKind, nonce]);

  const snapshotSrc = `${camera.snapshot_url}?t=${tick}`;

  return (
    <div
      className={cx(
        "@container relative aspect-[16/10] w-full overflow-hidden rounded-[18px] bg-[#040a14] transition-shadow duration-500",
        open ? "shadow-[0_0_0_1.5px_rgb(220_250_255/0.85),0_0_50px_-4px_rgb(160_240_255/0.55)]" : "shadow-[0_0_0_1px_rgb(173_214_240/0.1)]",
        className,
      )}
    >
      {useLive && liveKind !== "mjpeg" && camera.live ? (
        <iframe
          title={`Živý obraz: ${camera.name}`}
          src={camera.live.url}
          className="absolute inset-0 size-full border-0"
          allow="autoplay; fullscreen"
        />
      ) : useLive && !ended && camera.live ? (
        <img
          key={nonce}
          src={`${camera.live.url}?n=${nonce}`}
          alt={`Živý obraz z kamery ${camera.name}`}
          className="absolute inset-0 size-full"
          onError={() => setEnded(true)}
        />
      ) : (
        <img
          src={snapshotSrc}
          alt={`Poslední snímek z kamery ${camera.name}`}
          className="absolute inset-0 size-full"
          loading="lazy"
        />
      )}

      {boxes && <DetectionOverlay obs={detected} dim={live && !open} compact={compact} />}
      {boxes && <ChangedRegions obs={latest} />}

      {/* světlo při otevření dveří */}
      <div
        className={cx(
          "pointer-events-none absolute inset-0 transition-opacity duration-500",
          open ? "opacity-100" : "opacity-0",
        )}
        style={{ background: "radial-gradient(80% 60% at 50% 0%, rgb(230 250 255 / 0.22), transparent 70%)" }}
        aria-hidden
      />

      {useLive && ended && liveKind === "mjpeg" && (
        <div className="absolute inset-0 grid place-items-center bg-ink/70 backdrop-blur-sm">
          <div className="text-center">
            <p className="text-sm text-frost">Živý přenos se po chvíli sám vypne, kvůli baterii.</p>
            <button
              type="button"
              onClick={() => setNonce(Date.now())}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-frost px-4 text-sm font-medium text-ink"
            >
              <RefreshCw className="size-4" aria-hidden />
              Obnovit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
