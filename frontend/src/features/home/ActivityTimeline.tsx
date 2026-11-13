import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell,
  Camera,
  DoorClosed,
  DoorOpen,
  Minus,
  Phone,
  PhoneOff,
  Plus,
  RefreshCw,
  ShoppingCart,
  Tag,
  TimerReset,
  TriangleAlert,
  Info,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "../../store/app";
import { cx, relTime } from "../../lib/format";
import { EmojiTitle } from "../../ui/bits";
import type { EventKind, FridgeEvent, Severity } from "../../lib/types";

const ICON: Partial<Record<EventKind, LucideIcon>> = {
  item_added: Plus,
  item_removed: Minus,
  item_changed: RefreshCw,
  item_low: TriangleAlert,
  item_out: TriangleAlert,
  item_expiring: TimerReset,
  item_expired: TriangleAlert,
  door_opened: DoorOpen,
  door_closed: DoorClosed,
  door_open_too_long: DoorOpen,
  snapshot: Camera,
  deal_found: Tag,
  cart_updated: ShoppingCart,
  order_placed: ShoppingCart,
  call_started: Phone,
  call_ended: PhoneOff,
  notification_sent: Bell,
  system: Info,
};

const SEV: Record<Severity, string> = {
  info: "var(--color-sky)",
  success: "var(--color-glacier)",
  warning: "var(--color-apricot)",
  critical: "var(--color-tomato)",
};

function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

const MOUNTED_AT = Date.now();

function EventRow({ e, now }: { e: FridgeEvent; now: number }) {
  const Icon = ICON[e.kind] ?? Info;
  const color = SEV[e.severity];
  // zvýraznit jen události, které přišly živě (ne historii při načtení)
  const fresh = Date.parse(e.ts) > MOUNTED_AT - 3000;
  return (
    <motion.li
      layout="position"
      initial={fresh ? { opacity: 0, x: 16, backgroundColor: "rgba(110,240,216,0.10)" } : false}
      animate={{ opacity: 1, x: 0, backgroundColor: "rgba(110,240,216,0)" }}
      transition={{ duration: 0.5, backgroundColor: { duration: 2.4 } }}
      className="relative grid grid-cols-[28px_1fr] gap-3 rounded-xl py-2.5 pr-2"
    >
      <span
        className="relative z-10 mt-0.5 grid size-7 place-items-center rounded-full border bg-abyss"
        style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)`, color }}
        aria-hidden
      >
        <Icon className="size-3.5" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13.5px] leading-snug font-medium text-frost"><EmojiTitle text={e.title} /></p>
          <time dateTime={e.ts} className="tabular shrink-0 text-[11px] text-haze">
            {relTime(e.ts, now)}
          </time>
        </div>
        {e.detail && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-mist">{e.detail}</p>}
      </div>
    </motion.li>
  );
}

export function ActivityTimeline({ limit = 30, className }: { limit?: number; className?: string }) {
  const events = useApp((s) => s.events);
  const now = useNow();
  const shown = events.slice(0, limit);
  return (
    <div className={cx("relative", className)}>
      {/* svislá linka časové osy */}
      <div className="absolute top-3 bottom-3 left-[13.5px] w-px bg-gradient-to-b from-white/12 via-white/6 to-transparent" aria-hidden />
      <ol className="relative">
        <AnimatePresence initial={false}>
          {shown.map((e) => (
            <EventRow key={e.id} e={e} now={now} />
          ))}
        </AnimatePresence>
      </ol>
      {!shown.length && <p className="py-6 text-center text-sm text-mist">Zatím se nic nestalo. Otevři lednici.</p>}
    </div>
  );
}
