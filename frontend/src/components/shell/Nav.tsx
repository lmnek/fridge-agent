import { useState } from "react";
import {
  Camera,
  ChartColumn,
  ChefHat,
  Ellipsis,
  House,
  Refrigerator,
  Settings,
  ShoppingBasket,
  type LucideIcon,
} from "lucide-react";
import { useRoute, type RouteId } from "../../store/route";
import { useApp } from "../../store/app";
import { cx } from "../../lib/format";
import { AiButton } from "./AiButton";
import { Sheet } from "../../ui/Sheet";

export interface NavItem {
  id: RouteId;
  label: string;
  icon: LucideIcon;
}

export const NAV: NavItem[] = [
  { id: "domu", label: "Frida", icon: House },
  { id: "lednice", label: "Lednice", icon: Refrigerator },
  { id: "kamery", label: "Kamery", icon: Camera },
  { id: "nakup", label: "Nákup", icon: ShoppingBasket },
  { id: "jidlo", label: "Jídlo", icon: ChefHat },
  { id: "prehled", label: "Přehled", icon: ChartColumn },
  { id: "nastaveni", label: "Nastavení", icon: Settings },
];

function useBadge(id: RouteId): number {
  return useApp((s) => {
    if (id === "lednice") return (s.summary?.expiring ?? 0) + (s.summary?.expired ?? 0);
    if (id === "nakup") return s.cart?.lines.length ?? 0;
    return 0;
  });
}

function RailLink({ item }: { item: NavItem }) {
  const route = useRoute((s) => s.route);
  const go = useRoute((s) => s.go);
  const active = route === item.id;
  const badge = useBadge(item.id);
  const Icon = item.icon;
  return (
    <a
      href={item.id === "domu" ? "#/" : `#/${item.id}`}
      onClick={(e) => {
        e.preventDefault();
        go(item.id);
      }}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group relative flex w-full flex-col items-center gap-1 rounded-2xl py-2.5 text-[11px] transition-colors",
        active ? "text-frost" : "text-haze hover:text-mist",
      )}
    >
      <span
        className={cx(
          "grid size-10 place-items-center rounded-2xl transition-all",
          active ? "bg-glacier/12 text-glacier shadow-[inset_0_0_0_1px_rgb(110_240_216/0.25)]" : "group-hover:bg-white/5",
        )}
      >
        <Icon className="size-[19px]" strokeWidth={1.8} aria-hidden />
      </span>
      {item.label}
      {badge > 0 && (
        <span className="tabular absolute top-1.5 right-3 grid h-4 min-w-4 place-items-center rounded-full bg-apricot px-1 text-[10px] font-semibold text-ink">
          {badge}
        </span>
      )}
    </a>
  );
}

/** Desktop: úzký panel vlevo. */
export function NavRail() {
  const ws = useApp((s) => s.ws);
  return (
    <nav
      aria-label="Hlavní navigace"
      className="fixed inset-y-0 left-0 z-30 hidden w-[92px] flex-col items-center gap-1 border-r border-white/[0.05] bg-ink/40 px-2 py-5 backdrop-blur-xl lg:flex"
    >
      <a href="#/" className="mb-4 flex flex-col items-center" aria-label="Frida, domů">
        <span
          className="size-9 rounded-full animate-[breathe_6s_ease-in-out_infinite]"
          style={{
            background: "radial-gradient(circle at 34% 30%, #f2fdff 0%, #9ff7e6 18%, #5aa9ff 52%, #3b3f9e 82%, #101a3a 100%)",
            boxShadow: "0 0 18px -2px rgb(110 240 216 / 0.55), inset 0 -4px 8px rgb(7 17 31 / 0.45)",
          }}
          aria-hidden
        />
        <span className="mt-1.5 font-display text-[13px] leading-none font-semibold tracking-tight text-frost">Frida</span>
        <span
          className={cx(
            "mt-1.5 size-1.5 rounded-full",
            ws === "open" ? "bg-glacier shadow-[0_0_8px_var(--color-glacier)]" : ws === "connecting" ? "bg-butter" : "bg-tomato",
          )}
          title={ws === "open" ? "Spojení s lednicí běží" : "Spojení s lednicí se obnovuje"}
        />
      </a>
      {NAV.map((item) => (
        <RailLink key={item.id} item={item} />
      ))}
    </nav>
  );
}

const DOCK: RouteId[] = ["domu", "lednice", "nakup"];
const MORE: RouteId[] = ["kamery", "jidlo", "prehled", "nastaveni"];

function DockLink({ id, onClick }: { id: RouteId; onClick?: () => void }) {
  const item = NAV.find((n) => n.id === id)!;
  const route = useRoute((s) => s.route);
  const go = useRoute((s) => s.go);
  const badge = useBadge(id);
  const active = route === id;
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => {
        go(id);
        onClick?.();
      }}
      aria-current={active ? "page" : undefined}
      className={cx("relative flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px]", active ? "text-glacier" : "text-mist")}
    >
      <Icon className="size-[22px]" strokeWidth={1.8} aria-hidden />
      {item.label}
      {badge > 0 && (
        <span className="tabular absolute top-0 left-1/2 ml-2 grid h-4 min-w-4 place-items-center rounded-full bg-apricot px-1 text-[10px] font-semibold text-ink">
          {badge}
        </span>
      )}
    </button>
  );
}

/** Telefon: dok dole s Fridou uprostřed. */
export function MobileDock() {
  const [more, setMore] = useState(false);
  const route = useRoute((s) => s.route);
  const go = useRoute((s) => s.go);
  const moreActive = MORE.includes(route);
  return (
    <>
      <nav
        aria-label="Hlavní navigace"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.06] bg-[#081426]/80 pb-[var(--safe-b)] backdrop-blur-xl lg:hidden"
      >
        <div className="relative mx-auto flex h-16 max-w-md items-center px-2">
          <DockLink id={DOCK[0]} />
          <DockLink id={DOCK[1]} />
          <div className="w-[96px] shrink-0" aria-hidden />
          <DockLink id={DOCK[2]} />
          <button
            type="button"
            onClick={() => setMore(true)}
            className={cx("flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px]", moreActive ? "text-glacier" : "text-mist")}
            aria-haspopup="dialog"
          >
            <Ellipsis className="size-[22px]" aria-hidden />
            Více
          </button>
          <div className="absolute -top-9 left-1/2 -translate-x-1/2">
            <AiButton />
          </div>
        </div>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="Další" size="sm">
        <div className="grid grid-cols-2 gap-2 pb-2">
          {MORE.map((id) => {
            const item = NAV.find((n) => n.id === id)!;
            const Icon = item.icon;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  go(id);
                  setMore(false);
                }}
                className={cx(
                  "frost-chip flex items-center gap-3 rounded-2xl p-4 text-left",
                  route === id ? "text-glacier" : "text-frost",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
