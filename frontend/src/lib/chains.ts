/** Barvy řetězců (inspirované jejich značkou, ať se dají poznat na první pohled). */
export interface ChainStyle {
  bg: string;
  fg: string;
  dot: string; // barva pro tmavé pozadí (radar, grafy)
}

const CHAINS: Record<string, ChainStyle> = {
  albert: { bg: "#1D5FD1", fg: "#FFFFFF", dot: "#5C93F5" },
  lidl: { bg: "#0050AA", fg: "#FFF000", dot: "#FFE94D" },
  billa: { bg: "#FFE600", fg: "#C8001A", dot: "#FFE600" },
  kaufland: { bg: "#E10915", fg: "#FFFFFF", dot: "#FF5A5F" },
  penny: { bg: "#CD1719", fg: "#FFE14D", dot: "#FF8A5C" },
  tesco: { bg: "#00539F", fg: "#FFFFFF", dot: "#6FB4FF" },
  globus: { bg: "#00843D", fg: "#FFFFFF", dot: "#4FD68A" },
  rohlik: { bg: "#5FA52F", fg: "#FFFFFF", dot: "#9BE36A" },
  "rohlík": { bg: "#5FA52F", fg: "#FFFFFF", dot: "#9BE36A" },
  wolt: { bg: "#00C2E8", fg: "#062430", dot: "#00C2E8" },
  foodora: { bg: "#D70F64", fg: "#FFFFFF", dot: "#FF5A9B" },
};

const FALLBACK: ChainStyle = { bg: "#2A3B55", fg: "#DDEFF7", dot: "#8FA9BD" };

export function chainStyle(chain: string | null | undefined): ChainStyle {
  if (!chain) return FALLBACK;
  return CHAINS[chain.trim().toLowerCase()] ?? FALLBACK;
}

export function venueProvider(url: string | null | undefined, provider: string): "wolt" | "foodora" | string {
  if (url?.includes("wolt.com")) return "wolt";
  if (url?.includes("foodora")) return "foodora";
  return provider;
}
