import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, Plus, Search, ShoppingCart, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import type { DeliverySlot, GroceryProduct } from "../../lib/types";
import { isDemoMode, useApp } from "../../store/app";
import { DemoTag, inputCls, Panel, SectionTitle, Skeleton } from "../../ui/bits";
import { Button, IconButton } from "../../ui/Button";
import { cx, czk, parseDate, plural, timeShort, todayISO } from "../../lib/format";
import { ErrorLine, useAsync } from "./useAsync";

/** Jedním klikem do košíku všechno, co dochází. Nic neobjednává. */
export function useFillNeeds(): { fill: () => Promise<void>; filling: boolean } {
  const setCart = useApp((s) => s.setCart);
  const toast = useApp((s) => s.toast);
  const [filling, setFilling] = useState(false);
  const fill = async () => {
    setFilling(true);
    try {
      const before = useApp.getState().cart?.lines.length ?? 0;
      const cart = await api.fillNeeds();
      setCart(cart);
      const added = cart.lines.length - before;
      toast({
        title: added > 0 ? `V košíku ${plural(cart.lines.length, "je", "jsou", "je")} ${cart.lines.length} ${plural(cart.lines.length, "položka", "položky", "položek")}` : "Košík je aktuální",
        body: "Objednávku a platbu potvrdíš v Rohlíku.",
        tone: "success",
      });
    } catch (e) {
      toast({ title: "Košík se nepodařilo naplnit", body: e instanceof Error ? e.message : undefined, tone: "critical" });
    } finally {
      setFilling(false);
    }
  };
  return { fill, filling };
}

function dayLabel(iso: string): string {
  const d = parseDate(iso);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (key === todayISO()) return "dnes";
  if (key === todayISO(1)) return "zítra";
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }).format(d);
}

function Slots() {
  const res = useAsync<DeliverySlot[]>(() => api.slots(), []);
  const slots = (res.data ?? []).filter((s) => s.available).slice(0, 8);
  return (
    <div>
      <p className="mb-2 text-xs text-mist">Nejbližší volné termíny doručení</p>
      {res.error && <ErrorLine message={res.error} onRetry={res.reload} />}
      {res.loading && !res.data && <Skeleton className="h-12" />}
      {res.data && !slots.length && <p className="text-sm text-mist">Teď nejsou volné žádné termíny.</p>}
      {slots.length > 0 && (
        <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {slots.map((s) => (
            <li key={s.id} className="frost-chip shrink-0 rounded-2xl px-3 py-2">
              <span className="block text-[11px] text-mist">{dayLabel(s.start)}</span>
              <span className="tabular block text-sm text-frost">
                {timeShort(s.start)}–{timeShort(s.end)}
              </span>
              <span className={cx("tabular block text-[11px]", s.price_czk === 0 ? "text-glacier" : "text-mist")}>
                {s.price_czk === 0 ? "doprava zdarma" : czk(s.price_czk)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[11px] text-haze">Termín si vybereš až při dokončení v Rohlíku.</p>
    </div>
  );
}

function ProductSearch() {
  const id = useId();
  const setCart = useApp((s) => s.setCart);
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const res = useAsync<GroceryProduct[]>(() => api.grocerySearch(query), [query], query.length > 0);

  const add = async (p: GroceryProduct) => {
    setAdding(p.id);
    try {
      setCart(await api.addToCart([{ product_id: p.id, quantity: 1 }]));
    } catch (e) {
      toast({ title: "Do košíku se to nepovedlo přidat", body: e instanceof Error ? e.message : undefined, tone: "critical" });
    } finally {
      setAdding(null);
    }
  };

  return (
    <div>
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <label htmlFor={id} className="sr-only">
          Hledat v Rohlíku
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-haze" aria-hidden />
          <input
            id={id}
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Přidat z Rohlíku…"
            autoComplete="off"
            className={cx(inputCls, "h-10 pl-10 text-sm")}
          />
        </div>
        <Button type="submit" size="md" disabled={!draft.trim()}>
          Najít
        </Button>
      </form>
      {query && (
        <div className="mt-2" aria-live="polite">
          {res.error && <ErrorLine message={res.error} onRetry={res.reload} />}
          {res.loading && <Skeleton className="h-12" />}
          {!res.loading && res.data && !res.data.length && <p className="py-2 text-sm text-mist">V Rohlíku jsem nic takového nenašla.</p>}
          {!res.loading && res.data && res.data.length > 0 && (
            <ul className="space-y-1">
              {res.data.slice(0, 5).map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-xl px-1 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-frost">{p.name}</span>
                    <span className="block text-xs text-mist">
                      {p.package ?? ""}
                      {!p.in_stock && <span className="text-apricot"> není skladem</span>}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={cx("tabular block text-sm", p.on_sale ? "text-apricot" : "text-frost")}>{czk(p.price_czk)}</span>
                    {p.on_sale && p.original_price_czk && (
                      <span className="tabular block text-[11px] text-haze line-through">{czk(p.original_price_czk)}</span>
                    )}
                  </span>
                  <IconButton
                    label={`Přidat ${p.name} do košíku`}
                    size="sm"
                    variant="glass"
                    busy={adding === p.id}
                    disabled={!p.in_stock}
                    onClick={() => void add(p)}
                  >
                    <Plus className="size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function CartPanel({ fill, filling }: { fill: () => Promise<void>; filling: boolean }) {
  const cart = useApp((s) => s.cart);
  const setCart = useApp((s) => s.setCart);
  const toast = useApp((s) => s.toast);
  const mode = useApp((s) => s.integrations.rohlik);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const count = cart?.lines.length ?? 0;

  const load = () => {
    setLoadError(null);
    api
      .cart()
      .then(setCart)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "Košík se nepodařilo načíst."));
  };
  useEffect(load, [setCart]);

  // odkaz na dokončení předem, ať se otevře přímo z kliknutí (bez blokování vyskakovacích oken)
  useEffect(() => {
    if (!count) return;
    let alive = true;
    api
      .checkout()
      .then((r) => alive && setCheckoutUrl(r.url))
      .catch(() => alive && setCheckoutUrl(null));
    return () => {
      alive = false;
    };
  }, [count]);

  const change = async (productId: string, action: "add" | "remove") => {
    setBusyLine(productId);
    try {
      const next =
        action === "add" ? await api.addToCart([{ product_id: productId, quantity: 1 }]) : await api.removeFromCart(productId);
      setCart(next);
    } catch (e) {
      toast({ title: "Košík se nepodařilo upravit", body: e instanceof Error ? e.message : undefined, tone: "critical" });
    } finally {
      setBusyLine(null);
    }
  };

  const href = cart?.checkout_url ?? checkoutUrl;
  const demo = cart ? cart.mode === "demo" : isDemoMode(mode);

  return (
    <Panel aria-labelledby="rohlik-cart">
      <SectionTitle id="rohlik-cart" aside={demo ? <DemoTag>ukázkový košík</DemoTag> : undefined}>
        Košík v Rohlíku
      </SectionTitle>

      <Button
        variant="glass"
        icon={<Sparkles className="size-4 text-glacier" aria-hidden />}
        busy={filling}
        onClick={() => void fill()}
        className="w-full"
      >
        Dej do košíku, co dochází
      </Button>

      <div className="mt-4">
        {loadError && <ErrorLine message={loadError} onRetry={load} />}
        {!cart && !loadError && <Skeleton className="h-24" />}
        {cart && !count && (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-mist">
            <ShoppingCart className="size-5 shrink-0 text-haze" aria-hidden />
            Košík je prázdný. Nech Fridu doplnit, co dochází, nebo něco přidej níže.
          </div>
        )}
        {cart && count > 0 && (
          <ul className="divide-y divide-white/[0.05]">
            <AnimatePresence initial={false}>
              {cart.lines.map((l) => (
                <motion.li
                  key={l.product.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-3 py-2"
                >
                  <span className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-xs text-frost">
                    {l.quantity}×
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-frost">{l.product.name}</span>
                    <span className="block text-xs text-mist">
                      {l.product.package ? `${l.product.package}, ` : ""}
                      {czk(l.product.price_czk)} za kus
                    </span>
                  </span>
                  <span className="tabular text-sm text-frost">{czk(l.product.price_czk * l.quantity)}</span>
                  <IconButton
                    label={`Přidat další: ${l.product.name}`}
                    size="sm"
                    busy={busyLine === l.product.id}
                    onClick={() => void change(l.product.id, "add")}
                  >
                    <Plus className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Odebrat z košíku: ${l.product.name}`}
                    size="sm"
                    disabled={busyLine === l.product.id}
                    onClick={() => void change(l.product.id, "remove")}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {cart && count > 0 && (
        <div className="mt-3 flex items-baseline justify-between border-t border-white/[0.06] pt-3">
          <span className="text-sm text-mist">
            Celkem za {count} {plural(count, "položku", "položky", "položek")}
          </span>
          <span className="display-tight tabular text-[28px] leading-none font-semibold text-frost">{czk(cart.total_czk)}</span>
        </div>
      )}
      {cart?.delivery_note && <p className="mt-2 text-xs text-haze">{cart.delivery_note}</p>}

      <div className="mt-5 space-y-5">
        <ProductSearch />
        <Slots />
      </div>

      <div className="mt-5 rounded-2xl bg-white/[0.03] p-3">
        {href && count > 0 ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-apricot px-5 text-[15px] font-semibold text-ink shadow-[0_10px_30px_-12px_rgb(255_176_112/0.7)] transition-colors hover:bg-[#ffc38f]"
          >
            Dokončit v Rohlíku
            <ExternalLink className="size-4" aria-hidden />
          </a>
        ) : (
          <Button variant="warm" size="lg" disabled className="w-full">
            Dokončit v Rohlíku
          </Button>
        )}
        <p className="mt-2 text-center text-xs text-mist">
          Frida jen naplní košík. Objednávku a platbu potvrdíš v Rohlíku.
        </p>
      </div>
    </Panel>
  );
}
