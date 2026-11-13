import { useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Plus, ScanLine, Search } from "lucide-react";
import { PageHeader } from "../../components/shell/PageHeader";
import { useApp } from "../../store/app";
import { useRoute } from "../../store/route";
import type { InventoryItem, ItemStatus } from "../../lib/types";
import { czk, cx } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Empty, Pill, Skeleton } from "../../ui/bits";
import { ItemCard } from "./ItemCard";
import { ItemEditor } from "./ItemEditor";
import { useScan } from "./scanStore";

type Filter = "vse" | "konci" | "dochazi" | "doslo" | "prosle";

const FILTERS: { id: Filter; label: string; match: (s: ItemStatus) => boolean }[] = [
  { id: "vse", label: "Vše", match: () => true },
  { id: "konci", label: "Končí", match: (s) => s === "expiring" || s === "expired" },
  { id: "dochazi", label: "Dochází", match: (s) => s === "low" || s === "out" },
  { id: "doslo", label: "Došlo", match: (s) => s === "out" },
  { id: "prosle", label: "Prošlé", match: (s) => s === "expired" },
];

const URGENCY: Record<ItemStatus, number> = { expired: 0, expiring: 1, low: 2, ok: 3, out: 4 };

function sortItems(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort(
    (a, b) =>
      URGENCY[a.status] - URGENCY[b.status] ||
      (a.days_left ?? 999) - (b.days_left ?? 999) ||
      a.name.localeCompare(b.name, "cs"),
  );
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function InventoryView() {
  const items = useApp((s) => s.items);
  const summary = useApp((s) => s.summary);
  const loaded = useApp((s) => s.loaded);
  const param = useRoute((s) => s.param);
  const go = useRoute((s) => s.go);
  const startScan = useScan((s) => s.start);
  const addItem = useScan((s) => s.add);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<InventoryItem | null>(null);

  const filter: Filter = FILTERS.some((f) => f.id === param) ? (param as Filter) : "vse";
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, items.filter((i) => f.match(i.status)).length])) as Record<Filter, number>,
    [items],
  );
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    const q = fold(query.trim());
    return sortItems(items.filter((i) => f.match(i.status) && (!q || fold(i.name).includes(q))));
  }, [items, filter, query]);

  return (
    <div className="pb-6">
      <PageHeader
        title="Lednice"
        lead={
          summary
            ? `${summary.total_items} věcí za ${czk(summary.value_czk, { whole: true })}. Nahoře je to, co spěchá.`
            : "Načítám, co máš doma…"
        }
        actions={
          <>
            <Button variant="glass" icon={<ScanLine className="size-4" aria-hidden />} onClick={startScan}>
              Skenovat datum
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => addItem()}>
              Přidat
            </Button>
          </>
        }
      />

      <div className="sticky top-0 z-20 -mx-4 mb-5 flex flex-col gap-3 bg-ink/70 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 md:flex-row md:items-center lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none">
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1" role="group" aria-label="Filtr">
          {FILTERS.map((f) => (
            <Pill key={f.id} active={filter === f.id} count={counts[f.id]} onClick={() => go("lednice", f.id === "vse" ? null : f.id)}>
              {f.label}
            </Pill>
          ))}
        </div>
        <div className="relative md:ml-auto md:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-haze" aria-hidden />
          <label htmlFor="inv-search" className="sr-only">
            Hledat v lednici
          </label>
          <input
            id="inv-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat v lednici"
            className="h-9 w-full rounded-full border border-white/10 bg-ink/60 pr-4 pl-10 text-sm text-frost outline-none placeholder:text-haze focus:border-glacier/50"
          />
        </div>
      </div>

      {!loaded ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[230px] rounded-[22px]" />
          ))}
        </div>
      ) : shown.length ? (
        <div
          className={cx(
            "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
          )}
        >
          <AnimatePresence mode="popLayout">
            {shown.map((item) => (
              <ItemCard key={item.id} item={item} onEdit={setEditing} />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <Empty title={query ? "Nic takového v lednici není" : "Tady je prázdno"}>
          {query
            ? "Zkus jiné slovo, nebo to přidej."
            : filter === "vse"
              ? "Naskenuj první věc, nebo otevři lednici a Frida ji uvidí kamerou."
              : "V téhle skupině teď nic není. To je dobrá zpráva."}
        </Empty>
      )}

      <ItemEditor item={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
