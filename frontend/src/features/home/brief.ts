import type { InventoryItem } from "../../lib/types";
import { daysLabel } from "../../lib/format";

export interface Brief {
  line: string;
  prompt: string;
  promptLabel: string;
}

/** Co by Frida řekla právě teď, když se jí nikdo na nic neptá. */
export function composeBrief(items: InventoryItem[]): Brief {
  const present = items.filter((i) => i.status !== "out");
  const expired = present.filter((i) => i.status === "expired");
  const soon = present
    .filter((i) => i.status === "expiring")
    .sort((a, b) => (a.days_left ?? 99) - (b.days_left ?? 99));
  const out = items.filter((i) => i.status === "out" && i.staple);

  if (soon.length) {
    const first = soon[0];
    const others = soon.slice(1, 3).map((i) => i.name.toLowerCase());
    const when = daysLabel(first.days_left);
    const tail = others.length ? ` Pak ${others.join(" a ")}.` : "";
    return {
      line: `${first.name} je potřeba spotřebovat ${when}.${tail} Mám ti k tomu najít recept?`,
      prompt: `Co uvařit z toho, co se brzy zkazí? Hlavně ${first.name.toLowerCase()}.`,
      promptLabel: "Co z toho uvařit?",
    };
  }
  if (expired.length) {
    const first = expired[0];
    return {
      line: `Po datu spotřeby: ${first.name.toLowerCase()}. Když už se to nedá jíst, označ to v lednici jako vyhozené.`,
      prompt: "Co mám v lednici prošlého?",
      promptLabel: "Co je prošlé?",
    };
  }
  if (out.length) {
    const names = out.slice(0, 3).map((i) => i.name.toLowerCase());
    return {
      line: `Došlo ti ${names.join(", ")}. Můžu to dát do košíku v Rohlíku, nebo najít akci poblíž.`,
      prompt: "Objednej z Rohlíku, co dochází",
      promptLabel: "Dej to do košíku",
    };
  }
  if (!items.length) {
    return {
      line: "Zatím o tvé lednici nic nevím. Otevři ji, nebo naskenuj první věc.",
      prompt: "Jak tě mám nastavit?",
      promptLabel: "Jak začít?",
    };
  }
  return {
    line: "V lednici je všechno v pořádku. Na co máš dneska chuť?",
    prompt: "Co si dneska uvařit?",
    promptLabel: "Co uvařit?",
  };
}

export const SUGGESTIONS = [
  "Co mám v lednici?",
  "Co se kazí?",
  "Mám chuť na pizzu",
  "Naplánuj nákup",
  "Objednej z Rohlíku, co dochází",
];
