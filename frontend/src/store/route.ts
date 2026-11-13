import { create } from "zustand";

export type RouteId = "domu" | "lednice" | "kamery" | "nakup" | "jidlo" | "prehled" | "nastaveni";

export const ROUTES: RouteId[] = ["domu", "lednice", "kamery", "nakup", "jidlo", "prehled", "nastaveni"];

export interface RouteState {
  route: RouteId;
  /** volitelný parametr za lomítkem, např. #/lednice/konci */
  param: string | null;
  go: (route: RouteId, param?: string | null) => void;
}

function parse(hash: string): { route: RouteId; param: string | null } {
  const [, r, p] = hash.replace(/^#/, "").split("/");
  const route = (ROUTES as string[]).includes(r) ? (r as RouteId) : "domu";
  return { route, param: p ? decodeURIComponent(p) : null };
}

export const useRoute = create<RouteState>((set) => ({
  ...parse(window.location.hash),
  go: (route, param = null) => {
    const hash = route === "domu" && !param ? "#/" : `#/${route}${param ? `/${encodeURIComponent(param)}` : ""}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    else set({ route, param });
  },
}));

window.addEventListener("hashchange", () => {
  useRoute.setState(parse(window.location.hash));
  window.scrollTo({ top: 0 });
});
