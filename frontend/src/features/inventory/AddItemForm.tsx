import { useState } from "react";
import { Pin } from "lucide-react";
import { api } from "../../lib/api";
import type { Category, InventoryItemCreate, Shelf, Unit } from "../../lib/types";
import { cx, todayISO } from "../../lib/format";
import { useApp } from "../../store/app";
import { Field, SelectField } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { CATEGORY_LABEL, options, SHELF_LABEL, UNITS } from "./labels";

const DATE_CHIPS = [
  { label: "Dnes", days: 0 },
  { label: "Zítra", days: 1 },
  { label: "Za 3 dny", days: 3 },
  { label: "Za týden", days: 7 },
  { label: "Za 2 týdny", days: 14 },
];

export function DateChips({ value, onPick }: { value: string; onPick: (iso: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {DATE_CHIPS.map((c) => {
        const iso = todayISO(c.days);
        return (
          <button
            key={c.days}
            type="button"
            onClick={() => onPick(iso)}
            aria-pressed={value === iso}
            className={cx(
              "h-7 rounded-full px-2.5 text-xs transition-colors",
              value === iso ? "bg-glacier text-ink" : "frost-chip text-mist hover:text-frost",
            )}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/** Formulář nové věci. Předvyplní ho sken etikety nebo čárového kódu. */
export function AddItemForm({
  prefill,
  onDone,
  submitLabel = "Přidat do lednice",
}: {
  prefill: Partial<InventoryItemCreate>;
  onDone: () => void;
  submitLabel?: string;
}) {
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState(prefill.name ?? "");
  const [category, setCategory] = useState<Category>(prefill.category ?? "other");
  const [quantity, setQuantity] = useState(String(prefill.quantity ?? 1));
  const [unit, setUnit] = useState<Unit>(prefill.unit ?? "ks");
  const [shelf, setShelf] = useState<Shelf>(prefill.shelf ?? "unknown");
  const [expires, setExpires] = useState(prefill.expires_on ?? "");
  const [price, setPrice] = useState(prefill.price_czk ? String(prefill.price_czk) : "");
  const [staple, setStaple] = useState(prefill.staple ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Napiš, co to je.");
      return;
    }
    const qty = Number(quantity.replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Množství musí být kladné číslo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const item = await api.createItem({
        name: name.trim(),
        category,
        quantity: qty,
        unit,
        shelf,
        staple,
        expires_on: expires || null,
        price_czk: price ? Number(price.replace(",", ".")) : null,
        barcode: prefill.barcode ?? null,
      });
      toast({ title: `${item.name} je v lednici`, tone: "success" });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uložení se nepovedlo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid grid-cols-2 gap-x-3 gap-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field
        label="Co to je"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Třeba jogurt bílý"
        className="col-span-2"
        autoComplete="off"
        data-autofocus
      />
      <Field
        label="Množství"
        inputMode="decimal"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <SelectField
        label="Jednotka"
        value={unit}
        onChange={(e) => setUnit(e.target.value as Unit)}
        options={UNITS.map((u) => ({ value: u, label: u }))}
      />
      <div className="col-span-2">
        <Field label="Spotřebuj do" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        <DateChips value={expires} onPick={setExpires} />
        {!expires && <p className="mt-1.5 text-xs text-haze">Když datum nevyplníš, Frida ho odhadne podle druhu potraviny.</p>}
      </div>
      <SelectField
        label="Druh"
        value={category}
        onChange={(e) => setCategory(e.target.value as Category)}
        options={options(CATEGORY_LABEL)}
      />
      <SelectField
        label="Kde leží"
        value={shelf}
        onChange={(e) => setShelf(e.target.value as Shelf)}
        options={options(SHELF_LABEL)}
      />
      <Field label="Cena (Kč)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="nepovinné" />
      <div className="flex items-end">
        <button
          type="button"
          onClick={() => setStaple((v) => !v)}
          aria-pressed={staple}
          className={cx(
            "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm transition-colors",
            staple ? "border-glacier/50 bg-glacier/10 text-glacier" : "border-white/10 text-mist hover:text-frost",
          )}
        >
          <Pin className="size-4" aria-hidden />
          Chci ho mít vždycky
        </button>
      </div>
      {prefill.barcode && <p className="col-span-2 text-xs text-mist">Čárový kód {prefill.barcode}</p>}
      {error && (
        <p className="col-span-2 text-sm text-tomato" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" busy={busy} className="col-span-2">
        {submitLabel}
      </Button>
    </form>
  );
}
