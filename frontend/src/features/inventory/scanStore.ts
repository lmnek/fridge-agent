import { create } from "zustand";
import type { InventoryItemCreate } from "../../lib/types";

export type AddMode = "scan" | "add";

interface ScanState {
  /** zavřeno, skenování etikety, nebo rovnou ruční formulář */
  mode: AddMode | null;
  prefill: Partial<InventoryItemCreate>;
  start: () => void;
  add: (prefill?: Partial<InventoryItemCreate>) => void;
  close: () => void;
}

/** Přidání věci do lednice (ručně nebo naskenováním) jde otevřít odkudkoli. */
export const useScan = create<ScanState>((set) => ({
  mode: null,
  prefill: {},
  start: () => set({ mode: "scan", prefill: {} }),
  add: (prefill = {}) => set({ mode: "add", prefill }),
  close: () => set({ mode: null }),
}));
