"""Datový kontrakt Fridy (API + WebSocket).

Tenhle soubor je jediný zdroj pravdy o tvaru dat. Frontend má jeho zrcadlo
v `frontend/src/lib/types.ts` - při změně uprav obojí.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Základní číselníky
# ---------------------------------------------------------------------------

Category = Literal[
    "dairy",  # mléčné
    "cheese",
    "eggs",
    "meat",
    "fish",
    "deli",  # uzeniny, šunka
    "vegetables",
    "fruit",
    "bakery",
    "drinks",
    "ready_meals",
    "condiments",  # omáčky, dresinky, džemy
    "frozen",
    "other",
]

Unit = Literal["ks", "g", "kg", "ml", "l", "bal"]
Shelf = Literal["top", "middle", "bottom", "door", "drawer", "unknown"]
ItemStatus = Literal["ok", "low", "out", "expiring", "expired"]
ExpirySource = Literal["ocr", "vision", "estimated", "manual"]
Severity = Literal["info", "success", "warning", "critical"]
IntegrationMode = Literal["live", "demo"]


class BBox(BaseModel):
    """Normalizovaný obdélník (0..1) vůči snímku: levý horní roh + šířka/výška."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(ge=0, le=1)
    h: float = Field(ge=0, le=1)


# ---------------------------------------------------------------------------
# Inventář
# ---------------------------------------------------------------------------


class InventoryItem(BaseModel):
    id: str
    name: str  # "Mléko polotučné 1,5 %"
    canonical: str  # normalizovaný klíč pro párování s akcemi: "mleko"
    category: Category = "other"
    emoji: str = "🥫"
    quantity: float = 1
    unit: Unit = "ks"
    fill_level: float | None = Field(default=None, ge=0, le=1, description="U lahví a krabic: kolik zbývá")
    min_quantity: float = 0  # pod touto hranicí je položka "dochází"
    staple: bool = False  # základní potravina, kterou chceš mít vždycky doma
    shelf: Shelf = "unknown"
    camera_id: str | None = None
    bbox: BBox | None = None
    expires_on: date | None = None
    expiry_source: ExpirySource | None = None
    added_at: datetime
    last_seen_at: datetime | None = None
    confidence: float = 1.0
    barcode: str | None = None
    price_czk: float | None = None  # kolik stála (pro počítání vyhozených peněz)
    status: ItemStatus = "ok"
    days_left: int | None = None  # do expirace
    predicted_out_on: date | None = None  # odhad, kdy dojde (podle spotřeby)


class InventoryItemCreate(BaseModel):
    name: str
    category: Category = "other"
    quantity: float = 1
    unit: Unit = "ks"
    min_quantity: float = 0
    staple: bool = False
    shelf: Shelf = "unknown"
    expires_on: date | None = None
    price_czk: float | None = None
    barcode: str | None = None


class InventoryItemUpdate(BaseModel):
    name: str | None = None
    category: Category | None = None
    quantity: float | None = None
    unit: Unit | None = None
    fill_level: float | None = None
    min_quantity: float | None = None
    staple: bool | None = None
    shelf: Shelf | None = None
    expires_on: date | None = None
    price_czk: float | None = None


class InventorySummary(BaseModel):
    total_items: int
    low: int
    out: int
    expiring: int
    expired: int
    value_czk: float
    freshness_score: int = Field(ge=0, le=100, description="0-100, jak 'čerstvá' je lednice")
    waste_month_czk: float  # kolik se letos v měsíci vyhodilo


# ---------------------------------------------------------------------------
# Kamera a vision
# ---------------------------------------------------------------------------


class CameraInfo(BaseModel):
    id: str
    name: str
    channel: int
    mode: IntegrationMode
    online: bool
    battery_pct: int | None = None
    wifi_signal: int | None = None  # 0-100 nebo dBm podle zdroje
    last_snapshot_at: datetime | None = None
    snapshot_url: str  # relativní URL na backendu
    live: LiveStreamInfo | None = None


class LiveStreamInfo(BaseModel):
    """Jak pustit živý náhled. Bateriové kamery spí - živý přenos jen na vyžádání."""

    kind: Literal["webrtc", "mse", "mjpeg", "snapshot-poll"]
    url: str
    note: str | None = None


class Detection(BaseModel):
    label: str  # co model viděl, např. "mléko Madeta 1 l"
    canonical: str
    category: Category = "other"
    bbox: BBox | None = None
    confidence: float = Field(ge=0, le=1)
    quantity: float | None = None
    unit: Unit | None = None
    fill_level: float | None = Field(default=None, ge=0, le=1)
    shelf: Shelf = "unknown"
    expiry_text: str | None = None  # surový text z obalu
    expires_on: date | None = None
    source: Literal["claude", "local-vit", "mock", "manual"] = "mock"


class Observation(BaseModel):
    id: str
    camera_id: str
    taken_at: datetime
    image_url: str
    provider: str
    detections: list[Detection]
    latency_ms: int
    brightness: float | None = None  # 0..1, tma = zavřené dveře
    changed_regions: list[BBox] = []  # kde se oproti minulému snímku něco pohnulo
    note: str | None = None


class InventoryDiff(BaseModel):
    added: list[InventoryItem] = []
    removed: list[InventoryItem] = []
    changed: list[InventoryItem] = []


# ---------------------------------------------------------------------------
# Časová osa událostí
# ---------------------------------------------------------------------------

EventKind = Literal[
    "item_added",
    "item_removed",
    "item_changed",
    "item_low",
    "item_out",
    "item_expiring",
    "item_expired",
    "door_opened",
    "door_closed",
    "door_open_too_long",
    "snapshot",
    "deal_found",
    "cart_updated",
    "order_placed",
    "call_started",
    "call_ended",
    "notification_sent",
    "system",
]


class FridgeEvent(BaseModel):
    id: str
    ts: datetime
    kind: EventKind
    title: str
    detail: str | None = None
    severity: Severity = "info"
    item_id: str | None = None
    camera_id: str | None = None
    image_url: str | None = None
    data: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Poloha, obchody, akce
# ---------------------------------------------------------------------------


class GeoPoint(BaseModel):
    lat: float
    lon: float
    label: str | None = None
    source: Literal["browser", "config", "ip", "manual"] = "config"


class Store(BaseModel):
    id: str
    chain: str  # Albert, Lidl, Billa...
    name: str
    lat: float
    lon: float
    address: str | None = None
    distance_m: int | None = None
    opening_hours: str | None = None
    open_now: bool | None = None


class Deal(BaseModel):
    id: str
    product_name: str
    canonical: str
    chain: str
    price_czk: float
    original_price_czk: float | None = None
    discount_pct: int | None = None
    unit_price: float | None = None  # Kč za jednotku níže
    unit_price_unit: Literal["kg", "l", "ks"] | None = None
    package: str | None = None  # "1 l", "500 g"
    valid_from: date | None = None
    valid_to: date | None = None
    requires_card: bool = False  # např. Lidl Plus, Albert Bonus
    source: str  # kupi | akcniceny | rohlik | demo
    url: str | None = None
    image_url: str | None = None
    nearest_store: Store | None = None
    match_score: float = 1.0  # jak dobře sedí na hledaný výraz


class DealSearchResult(BaseModel):
    query: str
    canonical: str
    deals: list[Deal]
    best: Deal | None = None
    fetched_at: datetime
    sources: list[str]
    note: str | None = None


class PlanItem(BaseModel):
    query: str
    deal: Deal | None = None
    price_czk: float | None = None
    regular_price_czk: float | None = None


class PlanStop(BaseModel):
    kind: Literal["store", "online"]
    chain: str
    store: Store | None = None
    items: list[PlanItem]
    subtotal_czk: float


class ShoppingPlan(BaseModel):
    strategy: Literal["cheapest_split", "single_store", "online_delivery"]
    title: str
    stops: list[PlanStop]
    total_czk: float
    regular_total_czk: float
    savings_czk: float
    travel_m: int | None = None
    missing: list[str] = []
    score: float = 0  # nižší = lepší (cena + penalizace za cestu a zastávky)
    explanation: str


class PriceHistoryPoint(BaseModel):
    day: date
    chain: str
    price_czk: float


class PriceInsight(BaseModel):
    canonical: str
    current_best: float | None
    lowest_90d: float | None
    average_90d: float | None
    verdict: Literal["buy_now", "good", "wait", "unknown"]
    message: str
    history: list[PriceHistoryPoint] = []


# ---------------------------------------------------------------------------
# Online nákup (Rohlík MCP)
# ---------------------------------------------------------------------------


class GroceryProduct(BaseModel):
    id: str
    name: str
    price_czk: float
    unit_price: str | None = None
    package: str | None = None
    image_url: str | None = None
    in_stock: bool = True
    on_sale: bool = False
    original_price_czk: float | None = None
    url: str | None = None


class CartLine(BaseModel):
    product: GroceryProduct
    quantity: int


class Cart(BaseModel):
    provider: str  # rohlik | demo
    mode: IntegrationMode
    lines: list[CartLine]
    total_czk: float
    delivery_note: str | None = None
    checkout_url: str | None = None  # dokončení a platba vždy ručně v aplikaci/webu Rohlíku


class DeliverySlot(BaseModel):
    id: str
    start: datetime
    end: datetime
    price_czk: float
    available: bool = True


# ---------------------------------------------------------------------------
# Jídlo: recepty, chutě, rozvoz
# ---------------------------------------------------------------------------


class RecipeSuggestion(BaseModel):
    id: str
    title: str
    emoji: str = "🍳"
    minutes: int
    uses_item_ids: list[str] = []
    uses: list[str] = []  # názvy surovin z lednice
    missing: list[str] = []  # co je potřeba dokoupit
    rescue_score: int = Field(default=0, ge=0, le=100, description="Kolik zachrání potravin před vyhozením")
    steps: list[str] = []
    source: str = "frida"
    url: str | None = None


class DeliveryVenue(BaseModel):
    id: str
    name: str
    cuisine: list[str] = []
    rating: float | None = None
    delivery_minutes: int | None = None
    delivery_fee_czk: float | None = None
    distance_m: int | None = None
    price_level: int | None = None
    url: str | None = None
    image_url: str | None = None
    provider: str = "demo"


class CravingAnswer(BaseModel):
    craving: str
    cook_now: list[RecipeSuggestion]
    buy_and_cook: list[RecipeSuggestion]
    order_in: list[DeliveryVenue]
    message: str


# ---------------------------------------------------------------------------
# Notifikace a hovory
# ---------------------------------------------------------------------------

Channel = Literal["push", "sms", "whatsapp", "call"]


class Notification(BaseModel):
    id: str
    ts: datetime
    channel: Channel
    title: str
    body: str
    status: Literal["sent", "simulated", "suppressed", "failed"]
    reason: str | None = None  # proč (ne)odešlo: tiché hodiny, limit, demo...
    event_id: str | None = None


class TranscriptLine(BaseModel):
    role: Literal["user", "assistant", "system"]
    text: str
    ts: datetime


class CallSession(BaseModel):
    id: str
    direction: Literal["outbound", "inbound", "browser"]
    to_masked: str | None = None
    started_at: datetime
    ended_at: datetime | None = None
    status: Literal["queued", "ringing", "in-progress", "completed", "failed", "simulated", "refused"]
    reason: str  # proč se volá
    transcript: list[TranscriptLine] = []
    twilio_sid: str | None = None


class CallRequest(BaseModel):
    reason: str = "Test hovoru z aplikace"
    to: str | None = None  # prázdné = FRIDA_USER_PHONE


# ---------------------------------------------------------------------------
# Agent (chat)
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str
    ts: datetime
    tool_calls: list[ToolCallInfo] = []


class ToolCallInfo(BaseModel):
    id: str
    name: str
    title: str  # lidsky čitelný popis pro UI ("Hledám akce na mléko")
    input: dict[str, Any] = {}
    status: Literal["running", "done", "error"] = "running"
    summary: str | None = None


class ChatRequest(BaseModel):
    text: str
    conversation_id: str | None = None
    channel: Literal["text", "voice"] = "text"
    location: GeoPoint | None = None


# ---------------------------------------------------------------------------
# Nastavení, analytika, stav systému
# ---------------------------------------------------------------------------


class UserPreferences(BaseModel):
    location: GeoPoint
    favorite_chains: list[str]
    diet: list[str] = []  # vegetarian, bez lepku, bez laktózy...
    allergens: list[str] = []
    household_size: int = 2
    budget_week_czk: int | None = None
    notify_low_stock: bool = True
    notify_expiry: bool = True
    allow_calls: bool = True
    quiet_hours: tuple[int, int] = (22, 7)
    phone_masked: str | None = None


class UserPreferencesUpdate(BaseModel):
    location: GeoPoint | None = None
    favorite_chains: list[str] | None = None
    diet: list[str] | None = None
    allergens: list[str] | None = None
    household_size: int | None = None
    budget_week_czk: int | None = None
    notify_low_stock: bool | None = None
    notify_expiry: bool | None = None
    allow_calls: bool | None = None


class ConsumptionStat(BaseModel):
    canonical: str
    name: str
    emoji: str
    per_week: float
    unit: Unit
    predicted_out_on: date | None = None


class Analytics(BaseModel):
    consumption: list[ConsumptionStat]
    waste_by_month: list[dict[str, Any]]  # [{"month": "2026-10", "czk": 123.0, "items": 4}]
    savings_month_czk: float
    door_opens_today: int
    door_opens_by_hour: list[int]  # 24 hodnot


class SystemStatus(BaseModel):
    version: str
    integrations: dict[str, str]  # název -> live | demo | claude | local | cascade | mock
    cameras: list[CameraInfo]
    started_at: datetime
    now: datetime


# ---------------------------------------------------------------------------
# WebSocket obálka (/ws)
# ---------------------------------------------------------------------------

WsType = Literal[
    "hello",
    "event",  # payload: FridgeEvent
    "inventory",  # payload: {"items": [InventoryItem], "summary": InventorySummary}
    "observation",  # payload: Observation
    "camera",  # payload: CameraInfo
    "door",  # payload: {"camera_id": str, "open": bool}
    "notification",  # payload: Notification
    "call",  # payload: CallSession
    "cart",  # payload: Cart
    "agent.start",  # payload: {"conversation_id", "message_id"}
    "agent.delta",  # payload: {"conversation_id", "message_id", "text"}
    "agent.tool",  # payload: {"conversation_id", "message_id", "tool": ToolCallInfo}
    "agent.done",  # payload: {"conversation_id", "message_id", "message": ChatMessage}
    "agent.error",  # payload: {"conversation_id", "message_id", "error": str}
    "pong",
]


class WsEnvelope(BaseModel):
    type: WsType
    ts: datetime
    payload: dict[str, Any] = {}


CameraInfo.model_rebuild()
ChatMessage.model_rebuild()
