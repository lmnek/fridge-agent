import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DoorOpen, X } from "lucide-react";
import { selectAnyDoorOpen, useApp, type Toast } from "../../store/app";
import { cx } from "../../lib/format";
import { EmojiTitle } from "../../ui/bits";

/** Když se otevřou dveře lednice, rozsvítí se celá aplikace shora jako vnitřní světlo. */
export function DoorLight() {
  const open = useApp(selectAnyDoorOpen);
  const cameras = useApp((s) => s.cameras);
  const door = useApp((s) => s.door);
  const openedAt = useApp((s) => s.doorOpenedAt);
  const which = cameras.filter((c) => door[c.id]).map((c) => c.name);
  const since = Math.min(...Object.values(openedAt), Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);
  const secs = Math.max(0, Math.round((now - since) / 1000));

  return (
    <>
      <div
        aria-hidden
        className={cx(
          "pointer-events-none fixed inset-x-0 top-0 z-40 h-[3px] transition-opacity duration-500",
          open ? "opacity-100" : "opacity-0",
        )}
        style={{
          background: "linear-gradient(90deg, transparent, #e9fffb 20%, #ffffff 50%, #e9fffb 80%, transparent)",
          boxShadow: "0 0 30px 6px rgb(200 245 255 / 0.55), 0 0 120px 40px rgb(110 240 216 / 0.18)",
        }}
      />
      <div
        aria-hidden
        className={cx(
          "pointer-events-none fixed inset-x-0 top-0 z-0 h-[60vh] transition-opacity duration-700",
          open ? "opacity-100" : "opacity-0",
        )}
        style={{ background: "radial-gradient(70% 60% at 50% 0%, rgb(190 240 255 / 0.13), transparent 70%)" }}
      />
      <AnimatePresence>
        {open && (
          <motion.div
            role="status"
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -30, opacity: 0 }}
            className="fixed top-[calc(10px+var(--safe-t))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-frost px-3.5 py-1.5 text-[13px] font-medium text-ink shadow-[0_8px_40px_rgb(200_245_255/0.4)]"
          >
            <DoorOpen className="size-4" aria-hidden />
            Lednice je otevřená{which.length ? ` (${which.join(", ")})` : ""}
            <span className="tabular text-ink/55">{secs} s</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const TONE: Record<Toast["tone"], string> = {
  info: "var(--color-glacier)",
  success: "var(--color-glacier)",
  warning: "var(--color-apricot)",
  critical: "var(--color-tomato)",
};

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed top-[calc(52px+var(--safe-t))] right-3 left-3 z-[60] flex flex-col items-center gap-2 sm:top-5 sm:right-5 sm:left-auto sm:w-[360px] sm:items-stretch"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className="glass pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-2xl bg-[#0d1e34]/90 p-3.5 pr-2"
          >
            <span
              className="mt-1.5 size-2 shrink-0 rounded-full"
              style={{ background: TONE[t.tone], boxShadow: `0 0 10px ${TONE[t.tone]}` }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-frost"><EmojiTitle text={t.title} /></p>
              {t.body && <p className="mt-0.5 line-clamp-3 text-[13px] text-mist">{t.body}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="grid size-7 shrink-0 place-items-center rounded-full text-haze hover:bg-white/5 hover:text-frost"
              aria-label="Zavřít upozornění"
            >
              <X className="size-4" aria-hidden />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
