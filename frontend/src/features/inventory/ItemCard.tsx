import { useState } from "react";
import { motion } from "motion/react";
import { CalendarClock, Check, Pin, Plus, Trash2 } from "lucide-react";
import type { InventoryItem } from "../../lib/types";
import { api } from "../../lib/api";
import { useApp } from "../../store/app";
import { cx, daysLabel, FRESH_COLOR, freshness, initial, itemAmount, STATUS_LABEL } from "../../lib/format";
import { FillBar, Ring } from "../../ui/bits";

type Action = "eat" | "waste" | "restock" | "pin";

function fillOf(item: InventoryItem): number {
  if (item.fill_level !== null) return item.fill_level;
  if (item.status === "out") return 0;
  const ref = Math.max(item.min_quantity * 3, item.unit === "ks" || item.unit === "bal" ? 3 : item.quantity);
  return Math.min(1, item.quantity / (ref || 1));
}

const BADGE: Record<string, string> = {
  expired: "bg-tomato/15 text-tomato",
  expiring: "bg-apricot/15 text-apricot",
  low: "bg-butter/15 text-butter",
  out: "bg-white/[0.07] text-mist",
};

export function ItemCard({ item, onEdit }: { item: InventoryItem; onEdit: (item: InventoryItem) => void }) {
  const toast = useApp((s) => s.toast);
  const upsert = useApp((s) => s.upsertItem);
  const recent = useApp((s) => s.recent[item.id]);
  const [busy, setBusy] = useState<Action | null>(null);
  const out = item.status === "out";
  const f = freshness(out ? null : item.days_left);
  const color = FRESH_COLOR[f];
  const ringValue = item.days_left === null ? 1 : Math.max(0.03, Math.min(1, (item.days_left + 0.5) / 10));
  const fill = fillOf(item);
  const fillColor = item.status === "low" || out ? "var(--color-butter)" : "var(--color-glacier)";

  const act = async (a: Action) => {
    setBusy(a);
    try {
      if (a === "eat") {
        const res = await api.consume(item.id);
        const left = res.quantity > 0 && res.status !== "out" ? ` Zbývá ${itemAmount(res)}.` : "";
        toast({ title: `Snědeno: ${item.name}`, body: left || undefined, tone: "success" });
      } else if (a === "waste") {
        await api.removeItem(item.id, "wasted");
        toast({ title: `Vyhozeno: ${item.name}`, body: "Započítala jsem to do vyhozených peněz.", tone: "warning" });
      } else if (a === "restock") {
        const res = await api.restock(item.id);
        upsert(res);
        toast({ title: `Doplněno: ${item.name}`, tone: "success" });
      } else if (a === "pin") {
        const res = await api.updateItem(item.id, { staple: !item.staple });
        upsert(res);
      }
    } catch (err) {
      toast({ title: "Tohle se nepovedlo", body: err instanceof Error ? err.message : undefined, tone: "critical" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ type: "spring", damping: 28, stiffness: 320 }}
      className={cx(
        "glass group relative flex flex-col rounded-[22px] p-3.5 transition-shadow duration-700",
        out && "opacity-70",
        recent?.kind === "added" && "shadow-[0_0_0_1.5px_rgb(110_240_216/0.8),0_0_40px_-6px_rgb(110_240_216/0.6)]",
        recent?.kind === "changed" && "shadow-[0_0_0_1.5px_rgb(255_176_112/0.75),0_0_36px_-8px_rgb(255_176_112/0.55)]",
      )}
      aria-label={`${item.name}, ${itemAmount(item)}, ${out ? "došlo" : daysLabel(item.days_left)}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Ring value={out ? 0 : ringValue} size={54} stroke={3.5} color={color} label={out ? "došlo" : daysLabel(item.days_left)}>
          <span className="text-[19px] leading-none font-semibold text-frost" aria-hidden>
            {initial(item.name)}
          </span>
        </Ring>
        <div className="flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={() => void act("pin")}
            disabled={busy !== null}
            aria-pressed={item.staple}
            aria-label={item.staple ? "Odepnout ze základních potravin" : "Připnout jako základní potravinu"}
            title={item.staple ? "Základní potravina, chceš ji mít vždycky doma" : "Připnout jako základní potravinu"}
            className={cx(
              "grid size-7 place-items-center rounded-full transition-colors",
              item.staple ? "bg-glacier/15 text-glacier" : "text-haze opacity-60 hover:text-frost group-hover:opacity-100",
            )}
          >
            <Pin className={cx("size-3.5", item.staple && "fill-current")} aria-hidden />
          </button>
          {item.status !== "ok" && (
            <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", BADGE[item.status])}>
              {STATUS_LABEL[item.status]}
            </span>
          )}
        </div>
      </div>

      <h3 className="mt-3 line-clamp-2 font-sans text-[15px] leading-snug font-medium text-frost">{item.name}</h3>
      <p className="mt-0.5 text-[12.5px] text-mist">{out ? "Došlo, doplň při nákupu" : itemAmount(item)}</p>

      <FillBar value={fill} color={fillColor} className="mt-3" />

      <div className="mt-2 flex items-center justify-between text-[12.5px]">
        <span style={{ color: out ? "var(--color-mist)" : color }} className="font-medium">
          {out ? "–" : item.days_left === null ? "bez data" : daysLabel(item.days_left)}
        </span>
        {item.expiry_source === "estimated" && !out && <span className="text-[11px] text-haze">odhad</span>}
      </div>

      <div className="mt-3 flex items-center gap-1 border-t border-white/[0.06] pt-2.5">
        {out ? (
          <button
            type="button"
            onClick={() => void act("restock")}
            disabled={busy !== null}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full bg-glacier/12 text-[13px] text-glacier hover:bg-glacier/20"
          >
            <Plus className="size-3.5" aria-hidden />
            Doplnit
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void act("eat")}
              disabled={busy !== null}
              className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] text-frost hover:bg-white/[0.06]"
            >
              <Check className="size-3.5 text-glacier" aria-hidden />
              Snědeno
            </button>
            <button
              type="button"
              onClick={() => void act("waste")}
              disabled={busy !== null}
              aria-label={`Vyhodit ${item.name}`}
              title="Vyhozeno"
              className="grid size-8 place-items-center rounded-full text-mist hover:bg-tomato/10 hover:text-tomato"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => void act("restock")}
              disabled={busy !== null}
              aria-label={`Doplnit ${item.name}`}
              title="Doplnit"
              className="grid size-8 place-items-center rounded-full text-mist hover:bg-white/[0.06] hover:text-frost"
            >
              <Plus className="size-3.5" aria-hidden />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => onEdit(item)}
          aria-label={`Upravit ${item.name} a datum spotřeby`}
          title="Upravit datum spotřeby"
          className="grid size-8 place-items-center rounded-full text-mist hover:bg-white/[0.06] hover:text-frost"
        >
          <CalendarClock className="size-3.5" aria-hidden />
        </button>
      </div>
    </motion.article>
  );
}
