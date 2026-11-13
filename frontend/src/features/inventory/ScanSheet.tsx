import { useEffect, useRef, useState } from "react";
import { Barcode, Camera, PencilLine, ScanLine } from "lucide-react";
import { api } from "../../lib/api";
import type { InventoryItemCreate, ScanResult } from "../../lib/types";
import { dateShort } from "../../lib/format";
import { Sheet } from "../../ui/Sheet";
import { Button } from "../../ui/Button";
import { inputCls } from "../../ui/bits";
import { AddItemForm } from "./AddItemForm";
import { useScan } from "./scanStore";

interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function barcodeDetector(): BarcodeDetectorLike | null {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
  } catch {
    return null;
  }
}

/** Čárový kód přímo z fotky, pokud to prohlížeč umí (Chrome na Androidu, Safari 17+ částečně). */
async function readBarcode(file: File): Promise<string | null> {
  const detector = barcodeDetector();
  if (!detector) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const codes = await detector.detect(bitmap);
    bitmap.close?.();
    return codes[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

type Step = { kind: "capture" } | { kind: "reading"; preview: string } | { kind: "review"; preview?: string; result?: ScanResult };

function Capture({ onFile, onBarcode, onManual }: { onFile: (f: File) => void; onBarcode: (code: string) => void; onManual: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  return (
    <div className="space-y-5 pb-2">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="group relative grid aspect-[16/10] w-full place-items-center overflow-hidden rounded-[22px] border border-dashed border-glacier/35 bg-glacier/[0.04] text-center transition-colors hover:bg-glacier/[0.08]"
      >
        {/* rohy hledáčku */}
        {["top-4 left-4 border-t-2 border-l-2", "top-4 right-4 border-t-2 border-r-2", "bottom-4 left-4 border-b-2 border-l-2", "right-4 bottom-4 border-r-2 border-b-2"].map((c) => (
          <span key={c} className={`absolute size-7 rounded-[4px] border-glacier ${c}`} aria-hidden />
        ))}
        <span className="absolute inset-x-10 top-1/2 h-px bg-glacier/60 shadow-[0_0_14px_var(--color-glacier)] motion-safe:animate-pulse" aria-hidden />
        <span className="relative flex flex-col items-center gap-2 px-6">
          <Camera className="size-8 text-glacier" aria-hidden />
          <span className="font-display text-xl text-frost">Vyfoť datum spotřeby</span>
          <span className="max-w-xs text-sm text-mist">Stačí etiketa s datem. Když je vidět i čárový kód, přečtu ho taky.</span>
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Fotka etikety"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) onBarcode(code.trim());
        }}
      >
        <div className="flex-1">
          <label htmlFor="ean" className="mb-1.5 block text-xs text-mist">
            Nebo opiš čárový kód
          </label>
          <input
            id="ean"
            inputMode="numeric"
            pattern="[0-9]*"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="8594001234567"
            className={inputCls}
          />
        </div>
        <Button type="submit" variant="glass" size="lg" icon={<Barcode className="size-4" aria-hidden />} disabled={code.length < 8}>
          Najít
        </Button>
      </form>
      <button type="button" onClick={onManual} className="inline-flex items-center gap-2 text-sm text-mist hover:text-frost">
        <PencilLine className="size-4" aria-hidden />
        Zadat všechno ručně
      </button>
    </div>
  );
}

export function ScanSheet() {
  const mode = useScan((s) => s.mode);
  const prefill = useScan((s) => s.prefill);
  const close = useScan((s) => s.close);
  const [step, setStep] = useState<Step>({ kind: "capture" });
  const [error, setError] = useState<string | null>(null);

  const urls = useRef<string[]>([]);

  useEffect(() => {
    if (mode === "scan") setStep({ kind: "capture" });
    if (mode === "add") setStep({ kind: "review" });
    setError(null);
    if (mode === null) {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    }
  }, [mode]);

  const run = async (file: File | null, barcode: string | null) => {
    setError(null);
    const preview = file ? URL.createObjectURL(file) : "";
    if (preview) urls.current.push(preview);
    setStep({ kind: "reading", preview });
    try {
      const code = barcode ?? (file ? await readBarcode(file) : null);
      const result = await api.scan(file, code);
      setStep({ kind: "review", preview, result });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sken se nepovedl.");
      setStep({ kind: "capture" });
    }
  };

  const result = step.kind === "review" ? step.result : undefined;
  const formPrefill: Partial<InventoryItemCreate> = result
    ? {
        ...prefill,
        name: result.product ?? prefill.name ?? "",
        expires_on: result.expires_on ?? prefill.expires_on ?? null,
        barcode: result.barcode ?? null,
      }
    : prefill;

  return (
    <Sheet
      open={mode !== null}
      onClose={close}
      title={mode === "add" ? "Přidat do lednice" : "Skenovat datum"}
      subtitle={step.kind === "capture" ? "Nejrychlejší je vyfotit etiketu telefonem." : undefined}
    >
      {error && (
        <p className="mb-4 rounded-xl bg-tomato/10 px-3 py-2 text-sm text-tomato" role="alert">
          {error}
        </p>
      )}
      {step.kind === "capture" && (
        <Capture
          onFile={(f) => void run(f, null)}
          onBarcode={(c) => void run(null, c)}
          onManual={() => setStep({ kind: "review" })}
        />
      )}
      {step.kind === "reading" && (
        <div className="flex flex-col items-center gap-4 py-8 text-center" role="status">
          {step.preview && <img src={step.preview} alt="" className="max-h-48 rounded-2xl object-contain opacity-70" />}
          <ScanLine className="size-7 animate-pulse text-glacier" aria-hidden />
          <p className="font-display text-lg">Čtu etiketu…</p>
        </div>
      )}
      {step.kind === "review" && (
        <div className="space-y-5 pb-2">
          {result && (
            <div className="flex gap-3 rounded-2xl bg-white/[0.04] p-3">
              {step.preview && <img src={step.preview} alt="Vyfocená etiketa" className="size-16 shrink-0 rounded-xl object-cover" />}
              <div className="min-w-0 text-sm">
                {result.product || result.expires_on ? (
                  <p className="text-frost">
                    {result.product ? `Je to ${result.product}` : "Výrobek nepoznávám"}
                    {result.expires_on ? `, spotřebuj do ${dateShort(result.expires_on)}.` : "."}
                  </p>
                ) : (
                  <p className="text-frost">Z fotky jsem nic nevyčetla.</p>
                )}
                {result.note && <p className="mt-1 text-mist">{result.note}</p>}
                {!result.expires_on && !result.note && <p className="mt-1 text-mist">Datum doplň ručně, zabere to vteřinu.</p>}
              </div>
            </div>
          )}
          <AddItemForm key={JSON.stringify(formPrefill)} prefill={formPrefill} onDone={close} />
          {mode === "scan" && (
            <button type="button" onClick={() => setStep({ kind: "capture" })} className="text-sm text-mist hover:text-frost">
              Skenovat znovu
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
