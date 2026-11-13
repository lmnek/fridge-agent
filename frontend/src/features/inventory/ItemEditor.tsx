import { useEffect, useState } from "react";
import type { InventoryItem, Unit } from "../../lib/types";
import { api } from "../../lib/api";
import { useApp } from "../../store/app";
import { dateShort } from "../../lib/format";
import { Sheet } from "../../ui/Sheet";
import { Button } from "../../ui/Button";
import { Field, SelectField, Toggle } from "../../ui/bits";
import { DateChips } from "./AddItemForm";
import { UNITS } from "./labels";

const SOURCE: Record<string, string> = {
  ocr: "přečteno z etikety",
  vision: "z kamery",
  estimated: "odhad podle druhu",
  manual: "zadáno ručně",
};

/** Úprava položky, hlavně data spotřeby. */
export function ItemEditor({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const upsert = useApp((s) => s.upsertItem);
  const [expires, setExpires] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<Unit>("ks");
  const [fill, setFill] = useState<number | null>(null);
  const [minQty, setMinQty] = useState("");
  const [staple, setStaple] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!item) return;
    setExpires(item.expires_on ?? "");
    setQuantity(String(item.quantity));
    setUnit(item.unit);
    setFill(item.fill_level);
    setMinQty(String(item.min_quantity));
    setStaple(item.staple);
  }, [item]);

  const save = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const res = await api.updateItem(item.id, {
        expires_on: expires || null,
        quantity: Number(quantity.replace(",", ".")) || 0,
        unit,
        fill_level: fill,
        min_quantity: Number(minQty.replace(",", ".")) || 0,
        staple,
      });
      upsert(res);
      toast({ title: `Uloženo: ${res.name}`, body: res.expires_on ? `Spotřebuj do ${dateShort(res.expires_on)}.` : undefined, tone: "success" });
      onClose();
    } catch (err) {
      toast({ title: "Uložení se nepovedlo", body: err instanceof Error ? err.message : undefined, tone: "critical" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      size="sm"
      title={
        item ? (
          <span>{item.name}</span>
        ) : (
          ""
        )
      }
      subtitle={item?.expiry_source ? `Datum: ${SOURCE[item.expiry_source] ?? item.expiry_source}` : undefined}
      footer={
        <Button variant="primary" size="lg" className="w-full" busy={busy} onClick={() => void save()}>
          Uložit
        </Button>
      }
    >
      <div className="space-y-5">
        <div>
          <Field label="Spotřebuj do" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} data-autofocus />
          <DateChips value={expires} onPick={setExpires} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Množství" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <SelectField
            label="Jednotka"
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            options={UNITS.map((u) => ({ value: u, label: u }))}
          />
        </div>
        {fill !== null && (
          <div>
            <label htmlFor="fill" className="mb-1.5 flex justify-between text-xs text-mist">
              <span>Kolik zbývá</span>
              <span className="tabular text-frost">{Math.round(fill * 100)} %</span>
            </label>
            <input
              id="fill"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(fill * 100)}
              onChange={(e) => setFill(Number(e.target.value) / 100)}
              className="w-full accent-[var(--color-glacier)]"
            />
          </div>
        )}
        <Field
          label="Hlídat, když klesne pod"
          inputMode="decimal"
          value={minQty}
          onChange={(e) => setMinQty(e.target.value)}
          hint="Pod tímhle množstvím ti Frida řekne, že dochází."
        />
        <Toggle checked={staple} onChange={setStaple} label="Základní potravina" hint="Když dojde, Frida ji sama přidá do nákupu." />
      </div>
    </Sheet>
  );
}
