/**
 * Zrcadlo `backend/frida/schemas.py`. Při změně kontraktu uprav obojí.
 * Datumy (date) i časy (datetime) chodí jako ISO řetězce.
 * Pole s výchozí hodnotou v Pydanticu v odpovědích vždy přijdou, proto tu nejsou volitelná.
 */

export type ISODate = string; // "2026-11-13"
export type ISODateTime = string; // "2026-11-13T00:02:46.030176Z"

// ---------------------------------------------------------------- číselníky
export type Category =
  | "dairy"
  | "cheese"
  | "eggs"
  | "meat"
  | "fish"
  | "deli"
  | "vegetables"
  | "fruit"
  | "bakery"
  | "drinks"
  | "ready_meals"
  | "condiments"
  | "frozen"
  | "other";

export type Unit = "ks" | "g" | "kg" | "ml" | "l" | "bal";
export type Shelf = "top" | "middle" | "bottom" | "door" | "drawer" | "unknown";
export type ItemStatus = "ok" | "low" | "out" | "expiring" | "expired";
export type ExpirySource = "ocr" | "vision" | "estimated" | "manual";
export type Severity = "info" | "success" | "warning" | "critical";
export type IntegrationMode = "live" | "demo";

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------- inventář
export interface InventoryItem {
  id: string;
  name: string;
  canonical: string;
  category: Category;
  emoji: string;
  quantity: number;
  unit: Unit;
  fill_level: number | null;
  min_quantity: number;
  staple: boolean;
  shelf: Shelf;
  camera_id: string | null;
  bbox: BBox | null;
  expires_on: ISODate | null;
  expiry_source: ExpirySource | null;
  added_at: ISODateTime;
  last_seen_at: ISODateTime | null;
  confidence: number;
  barcode: string | null;
  price_czk: number | null;
  status: ItemStatus;
  days_left: number | null;
  predicted_out_on: ISODate | null;
}

export interface InventoryItemCreate {
  name: string;
  category?: Category;
  quantity?: number;
  unit?: Unit;
  min_quantity?: number;
  staple?: boolean;
  shelf?: Shelf;
  expires_on?: ISODate | null;
  price_czk?: number | null;
  barcode?: string | null;
}

export interface InventoryItemUpdate {
  name?: string | null;
  category?: Category | null;
  quantity?: number | null;
  unit?: Unit | null;
  fill_level?: number | null;
  min_quantity?: number | null;
  staple?: boolean | null;
  shelf?: Shelf | null;
  expires_on?: ISODate | null;
  price_czk?: number | null;
}

export interface InventorySummary {
  total_items: number;
  low: number;
  out: number;
  expiring: number;
  expired: number;
  value_czk: number;
  freshness_score: number;
  waste_month_czk: number;
}

export interface InventorySnapshot {
  items: InventoryItem[];
  summary: InventorySummary;
}

// ---------------------------------------------------------------- kamera a vision
export interface LiveStreamInfo {
  kind: "webrtc" | "mse" | "mjpeg" | "snapshot-poll";
  url: string;
  note: string | null;
}

export interface CameraInfo {
  id: string;
  name: string;
  channel: number;
  mode: IntegrationMode;
  online: boolean;
  battery_pct: number | null;
  wifi_signal: number | null;
  last_snapshot_at: ISODateTime | null;
  snapshot_url: string;
  live: LiveStreamInfo | null;
}

export type DetectionSource = "claude" | "local-vit" | "mock" | "manual";

export interface Detection {
  label: string;
  canonical: string;
  category: Category;
  bbox: BBox | null;
  confidence: number;
  quantity: number | null;
  unit: Unit | null;
  fill_level: number | null;
  shelf: Shelf;
  expiry_text: string | null;
  expires_on: ISODate | null;
  source: DetectionSource;
}

export interface Observation {
  id: string;
  camera_id: string;
  taken_at: ISODateTime;
  image_url: string;
  provider: string;
  detections: Detection[];
  latency_ms: number;
  brightness: number | null;
  changed_regions: BBox[];
  note: string | null;
}

export interface InventoryDiff {
  added: InventoryItem[];
  removed: InventoryItem[];
  changed: InventoryItem[];
}

// ---------------------------------------------------------------- události
export type EventKind =
  | "item_added"
  | "item_removed"
  | "item_changed"
  | "item_low"
  | "item_out"
  | "item_expiring"
  | "item_expired"
  | "door_opened"
  | "door_closed"
  | "door_open_too_long"
  | "snapshot"
  | "deal_found"
  | "cart_updated"
  | "order_placed"
  | "call_started"
  | "call_ended"
  | "notification_sent"
  | "system";

export interface FridgeEvent {
  id: string;
  ts: ISODateTime;
  kind: EventKind;
  title: string;
  detail: string | null;
  severity: Severity;
  item_id: string | null;
  camera_id: string | null;
  image_url: string | null;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------- poloha, obchody, akce
export interface GeoPoint {
  lat: number;
  lon: number;
  label: string | null;
  source: "browser" | "config" | "ip" | "manual";
}

export interface Store {
  id: string;
  chain: string;
  name: string;
  lat: number;
  lon: number;
  address: string | null;
  distance_m: number | null;
  opening_hours: string | null;
  open_now: boolean | null;
}

export interface Deal {
  id: string;
  product_name: string;
  canonical: string;
  chain: string;
  price_czk: number;
  original_price_czk: number | null;
  discount_pct: number | null;
  unit_price: number | null;
  unit_price_unit: "kg" | "l" | "ks" | null;
  package: string | null;
  valid_from: ISODate | null;
  valid_to: ISODate | null;
  requires_card: boolean;
  source: string;
  url: string | null;
  image_url: string | null;
  nearest_store: Store | null;
  match_score: number;
}

export interface DealSearchResult {
  query: string;
  canonical: string;
  deals: Deal[];
  best: Deal | null;
  fetched_at: ISODateTime;
  sources: string[];
  note: string | null;
}

export interface PlanItem {
  query: string;
  deal: Deal | null;
  price_czk: number | null;
  regular_price_czk: number | null;
}

export interface PlanStop {
  kind: "store" | "online";
  chain: string;
  store: Store | null;
  items: PlanItem[];
  subtotal_czk: number;
}

export type PlanStrategy = "cheapest_split" | "single_store" | "online_delivery";

export interface ShoppingPlan {
  strategy: PlanStrategy;
  title: string;
  stops: PlanStop[];
  total_czk: number;
  regular_total_czk: number;
  savings_czk: number;
  travel_m: number | null;
  missing: string[];
  score: number;
  explanation: string;
}

export interface PriceHistoryPoint {
  day: ISODate;
  chain: string;
  price_czk: number;
}

export interface PriceInsight {
  canonical: string;
  current_best: number | null;
  lowest_90d: number | null;
  average_90d: number | null;
  verdict: "buy_now" | "good" | "wait" | "unknown";
  message: string;
  history: PriceHistoryPoint[];
}

// ---------------------------------------------------------------- Rohlík
export interface GroceryProduct {
  id: string;
  name: string;
  price_czk: number;
  unit_price: string | null;
  package: string | null;
  image_url: string | null;
  in_stock: boolean;
  on_sale: boolean;
  original_price_czk: number | null;
  url: string | null;
}

export interface CartLine {
  product: GroceryProduct;
  quantity: number;
}

export interface Cart {
  provider: string;
  mode: IntegrationMode;
  lines: CartLine[];
  total_czk: number;
  delivery_note: string | null;
  checkout_url: string | null;
}

export interface DeliverySlot {
  id: string;
  start: ISODateTime;
  end: ISODateTime;
  price_czk: number;
  available: boolean;
}

// ---------------------------------------------------------------- jídlo
export interface RecipeSuggestion {
  id: string;
  title: string;
  emoji: string;
  minutes: number;
  uses_item_ids: string[];
  uses: string[];
  missing: string[];
  rescue_score: number;
  steps: string[];
  source: string;
  url: string | null;
}

export interface DeliveryVenue {
  id: string;
  name: string;
  cuisine: string[];
  rating: number | null;
  delivery_minutes: number | null;
  delivery_fee_czk: number | null;
  distance_m: number | null;
  price_level: number | null;
  url: string | null;
  image_url: string | null;
  provider: string;
}

export interface CravingAnswer {
  craving: string;
  cook_now: RecipeSuggestion[];
  buy_and_cook: RecipeSuggestion[];
  order_in: DeliveryVenue[];
  message: string;
}

// ---------------------------------------------------------------- notifikace a hovory
export type Channel = "push" | "sms" | "whatsapp" | "call";

export interface Notification {
  id: string;
  ts: ISODateTime;
  channel: Channel;
  title: string;
  body: string;
  status: "sent" | "simulated" | "suppressed" | "failed";
  reason: string | null;
  event_id: string | null;
}

export interface TranscriptLine {
  role: "user" | "assistant" | "system";
  text: string;
  ts: ISODateTime;
}

export type CallStatus =
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "failed"
  | "simulated"
  | "refused";

export interface CallSession {
  id: string;
  direction: "outbound" | "inbound" | "browser";
  to_masked: string | null;
  started_at: ISODateTime;
  ended_at: ISODateTime | null;
  status: CallStatus;
  reason: string;
  transcript: TranscriptLine[];
  twilio_sid: string | null;
}

export interface CallRequest {
  reason?: string;
  to?: string | null;
}

// ---------------------------------------------------------------- agent
export interface ToolCallInfo {
  id: string;
  name: string;
  title: string;
  input: Record<string, unknown>;
  status: "running" | "done" | "error";
  summary: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  ts: ISODateTime;
  tool_calls: ToolCallInfo[];
}

export type ChatChannel = "text" | "voice";

export interface ChatRequest {
  text: string;
  conversation_id?: string | null;
  channel?: ChatChannel;
  location?: GeoPoint | null;
  call_session_id?: string | null;
}

export interface ChatResponse {
  conversation_id: string;
  message: ChatMessage;
  hangup: boolean;
}

// ---------------------------------------------------------------- nastavení, analytika, stav
export interface UserPreferences {
  location: GeoPoint;
  favorite_chains: string[];
  diet: string[];
  allergens: string[];
  household_size: number;
  budget_week_czk: number | null;
  notify_low_stock: boolean;
  notify_expiry: boolean;
  allow_calls: boolean;
  quiet_hours: [number, number];
  phone_masked: string | null;
}

export interface UserPreferencesUpdate {
  location?: GeoPoint | null;
  favorite_chains?: string[] | null;
  diet?: string[] | null;
  allergens?: string[] | null;
  household_size?: number | null;
  budget_week_czk?: number | null;
  notify_low_stock?: boolean | null;
  notify_expiry?: boolean | null;
  allow_calls?: boolean | null;
}

export interface ConsumptionStat {
  canonical: string;
  name: string;
  emoji: string;
  per_week: number;
  unit: Unit;
  predicted_out_on: ISODate | null;
}

export interface WasteMonth {
  month: string; // "2026-10"
  czk: number;
  items: number;
}

export interface Analytics {
  consumption: ConsumptionStat[];
  waste_by_month: WasteMonth[];
  savings_month_czk: number;
  door_opens_today: number;
  door_opens_by_hour: number[];
}

export interface SystemStatus {
  version: string;
  integrations: Record<string, string>;
  cameras: CameraInfo[];
  started_at: ISODateTime;
  now: ISODateTime;
}

// ---------------------------------------------------------------- ostatní odpovědi
export interface DemoSceneObject {
  key: string;
  name: string;
  emoji: string;
  camera_id: string;
  fill_level: number | null;
  quantity: number;
}

export interface DemoScene {
  enabled: boolean;
  in_fridge: DemoSceneObject[];
  can_add: { key: string; name: string; emoji: string }[];
}

export type SimulateAction = "take" | "use" | "put";

export interface SimulateRequest {
  action: SimulateAction;
  item: string;
  amount?: number;
  expires_in_days?: number | null;
}

export interface SimulateResponse {
  ok: boolean;
  camera_id?: string;
  observation_id?: string | null;
  message: string;
}

export interface ScanResult {
  product: string | null;
  canonical: string | null;
  expires_on: ISODate | null;
  barcode: string | null;
  brand?: string | null;
  note?: string;
  [key: string]: unknown;
}

export interface RecipesResponse {
  message: string | null;
  recipes: RecipeSuggestion[];
}

export interface CookedResponse {
  ok: boolean;
  used: string[];
}

export interface CheckoutLink {
  url: string;
  note: string;
}

// ---------------------------------------------------------------- WebSocket
export type WsType =
  | "hello"
  | "event"
  | "inventory"
  | "observation"
  | "camera"
  | "door"
  | "notification"
  | "call"
  | "cart"
  | "agent.start"
  | "agent.delta"
  | "agent.tool"
  | "agent.done"
  | "agent.error"
  | "pong";

export interface WsEnvelope<P = Record<string, unknown>> {
  type: WsType;
  ts: ISODateTime;
  payload: P;
}

export interface HelloPayload {
  version: string;
  integrations: Record<string, string>;
  agent: "claude" | "scripted";
  door: Record<string, boolean>;
}

export interface DoorPayload {
  camera_id: string;
  open: boolean;
}

interface AgentBase {
  conversation_id: string;
  message_id: string;
}

export interface AgentStartPayload extends AgentBase {
  channel: ChatChannel;
}
export interface AgentDeltaPayload extends AgentBase {
  text: string;
}
export interface AgentToolPayload extends AgentBase {
  tool: ToolCallInfo;
}
export interface AgentDonePayload extends AgentBase {
  message: ChatMessage;
}
export interface AgentErrorPayload extends AgentBase {
  error: string;
}
