import { BatteryFull, BatteryLow, BatteryMedium, DoorClosed, DoorOpen, Wifi, WifiOff } from "lucide-react";
import { useApp } from "../../store/app";
import type { CameraInfo } from "../../lib/types";
import { cx } from "../../lib/format";

export function DoorBadge({ cameraId, className }: { cameraId: string; className?: string }) {
  const open = useApp((s) => !!s.door[cameraId]);
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium transition-colors",
        open ? "bg-frost text-ink shadow-[0_0_16px_rgb(200_245_255/0.6)]" : "bg-white/[0.06] text-mist",
        className,
      )}
    >
      {open ? <DoorOpen className="size-3.5" aria-hidden /> : <DoorClosed className="size-3.5" aria-hidden />}
      {open ? "Otevřeno" : "Zavřeno"}
    </span>
  );
}

export function CameraMeta({ camera, className }: { camera: CameraInfo; className?: string }) {
  const b = camera.battery_pct;
  const BatteryIcon = b === null ? BatteryMedium : b > 60 ? BatteryFull : b > 25 ? BatteryMedium : BatteryLow;
  const wifi = camera.wifi_signal;
  return (
    <div className={cx("flex items-center gap-2.5 text-[12px] text-mist", className)}>
      {b !== null && (
        <span className={cx("inline-flex items-center gap-1", b <= 25 && "text-apricot")} title="Baterie kamery">
          <BatteryIcon className="size-4" aria-hidden />
          <span className="tabular">{b} %</span>
          <span className="sr-only">baterie</span>
        </span>
      )}
      {wifi !== null && (
        <span className="inline-flex items-center gap-1" title="Síla Wi-Fi">
          {camera.online ? <Wifi className="size-4" aria-hidden /> : <WifiOff className="size-4 text-tomato" aria-hidden />}
          <span className="tabular">{wifi}</span>
          <span className="sr-only">síla signálu</span>
        </span>
      )}
      {!camera.online && <span className="text-tomato">offline</span>}
    </div>
  );
}
