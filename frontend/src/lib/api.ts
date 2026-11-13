import type {
  Analytics,
  CallSession,
  CameraInfo,
  Cart,
  ChatRequest,
  ChatResponse,
  CheckoutLink,
  CookedResponse,
  CravingAnswer,
  DealSearchResult,
  DeliverySlot,
  DemoScene,
  FridgeEvent,
  GeoPoint,
  GroceryProduct,
  InventoryItem,
  InventoryItemCreate,
  InventoryItemUpdate,
  InventorySnapshot,
  Notification,
  Observation,
  PriceInsight,
  RecipeSuggestion,
  RecipesResponse,
  ScanResult,
  ShoppingPlan,
  SimulateRequest,
  SimulateResponse,
  Store,
  SystemStatus,
  UserPreferences,
  UserPreferencesUpdate,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let msg = `Chyba ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") msg = body.detail;
      else if (Array.isArray(body?.detail)) msg = body.detail.map((d: { msg?: string }) => d.msg).join(", ");
    } catch {
      /* odpověď bez JSONu */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? "{}" : JSON.stringify(body) });
const patch = <T,>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });
const q = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export const api = {
  status: () => get<SystemStatus>("/api/status"),

  // inventář
  inventory: () => get<InventorySnapshot>("/api/inventory"),
  createItem: (data: InventoryItemCreate) => post<InventoryItem>("/api/inventory", data),
  updateItem: (id: string, data: InventoryItemUpdate) => patch<InventoryItem>(`/api/inventory/${id}`, data),
  removeItem: (id: string, reason: "consumed" | "wasted") =>
    del<InventoryItem>(`/api/inventory/${id}${q({ reason })}`),
  consume: (id: string, amount?: number) => post<InventoryItem>(`/api/inventory/${id}/consume`, { amount }),
  restock: (id: string, amount?: number) => post<InventoryItem>(`/api/inventory/${id}/restock`, { amount }),
  events: (limit = 50) => get<FridgeEvent[]>(`/api/events${q({ limit })}`),

  // kamery
  cameras: () => get<CameraInfo[]>("/api/cameras"),
  capture: (id: string) => post<Observation | null>(`/api/camera/${id}/capture`),
  simulate: (body: SimulateRequest) => post<SimulateResponse>("/api/camera/simulate", body),
  demoScene: () => get<DemoScene>("/api/demo/scene"),
  observations: (camera_id?: string, limit = 20) =>
    get<Observation[]>(`/api/observations${q({ camera_id, limit })}`),
  scan: (image: File | null, barcode: string | null) => {
    const fd = new FormData();
    if (image) fd.append("image", image);
    if (barcode) fd.append("barcode", barcode);
    return request<ScanResult>("/api/vision/scan", { method: "POST", body: fd });
  },

  // akce a obchody
  deals: (query: string) => get<DealSearchResult>(`/api/deals${q({ q: query })}`),
  insight: (query: string) => get<PriceInsight>(`/api/deals/insight${q({ q: query })}`),
  dealsForNeeds: () => get<DealSearchResult[]>("/api/deals/for-needs"),
  plan: (items: string[] = []) => post<ShoppingPlan[]>("/api/deals/plan", { items }),
  stores: () => get<Store[]>("/api/stores"),
  needs: () => get<InventoryItem[]>("/api/shopping/needs"),

  // Rohlík
  cart: () => get<Cart>("/api/grocery/cart"),
  grocerySearch: (query: string) => get<GroceryProduct[]>(`/api/grocery/search${q({ q: query })}`),
  addToCart: (items: { product_id: string; quantity: number }[]) => post<Cart>("/api/grocery/cart", { items }),
  removeFromCart: (productId: string) => del<Cart>(`/api/grocery/cart/${encodeURIComponent(productId)}`),
  fillNeeds: () => post<Cart>("/api/grocery/fill-needs"),
  checkout: () => get<CheckoutLink>("/api/grocery/checkout"),
  slots: () => get<DeliverySlot[]>("/api/grocery/slots"),

  // jídlo
  recipes: (craving?: string) => get<RecipesResponse>(`/api/recipes${q({ craving })}`),
  craving: (text: string) => post<CravingAnswer>("/api/craving", { text }),
  cooked: (recipe: RecipeSuggestion) => post<CookedResponse>(`/api/recipes/${encodeURIComponent(recipe.id)}/cooked`, recipe),

  // notifikace, hovory
  notifications: (limit = 30) => get<Notification[]>(`/api/notifications${q({ limit })}`),
  calls: () => get<CallSession[]>("/api/calls"),
  startCall: (reason: string) => post<CallSession>("/api/calls", { reason }),
  answerCall: (id: string) => post<CallSession>(`/api/calls/${id}/answer`),
  hangupCall: (id: string) => post<CallSession>(`/api/calls/${id}/hangup`),

  // chat
  chat: (body: ChatRequest) => post<ChatResponse>("/api/chat", body),

  // analytika a nastavení
  analytics: () => get<Analytics>("/api/analytics"),
  prefs: () => get<UserPreferences>("/api/prefs"),
  updatePrefs: (data: UserPreferencesUpdate) => patch<UserPreferences>("/api/prefs", data),
  setLocation: (point: GeoPoint) => post<GeoPoint>("/api/location", point),
};
