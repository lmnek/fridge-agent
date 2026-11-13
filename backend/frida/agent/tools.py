"""Nástroje, které Frida (agent) smí použít.

Každý nástroj má:
- Pydantic model vstupu (validuje se před spuštěním, i když vstup přišel
  proudově přes `eager_input_streaming`),
- lidsky čitelný titulek pro UI („Hledám akce: máslo“),
- kanály, ve kterých je dostupný (`text`, `voice`).

Bezpečnost: nástroje umí naplnit košík v Rohlíku, ale objednávku nikdy
nedokončí. Na to nemají ani nástroj. Hovor jde jen přes `NotificationService`
a `CallPolicy` (allowlist, limity, tiché hodiny).
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..food.delivery import delivery_options
from ..schemas import GeoPoint, InventoryItem, InventoryItemCreate, InventoryItemUpdate, ToolCallInfo
from ..text import czk

if TYPE_CHECKING:
    from ..services import Services

log = logging.getLogger(__name__)

MAX_RESULT_CHARS = 12_000


@dataclass
class ToolContext:
    svc: Services
    conversation_id: str
    message_id: str
    channel: Literal["text", "voice"]
    location: GeoPoint
    call_session_id: str | None = None
    hangup: bool = False
    hangup_reason: str | None = None
    tool_calls: list[ToolCallInfo] = field(default_factory=list)


Handler = Callable[[ToolContext, Any], Awaitable[tuple[Any, str]]]


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    model: type[BaseModel]
    handler: Handler
    title: Callable[[dict], str]
    channels: tuple[str, ...] = ("text", "voice")
    live_only: bool = False


# --------------------------------------------------------------------------- pomocníci
def item_brief(i: InventoryItem) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": i.id,
        "name": i.name,
        "qty": f"{i.quantity:g} {i.unit}",
        "status": i.status,
    }
    if i.fill_level is not None:
        out["fill"] = f"{round(i.fill_level * 100)} %"
    if i.expires_on:
        out["expires_on"] = i.expires_on.isoformat()
        out["days_left"] = i.days_left
    if i.staple:
        out["staple"] = True
    if i.predicted_out_on:
        out["predicted_out_on"] = i.predicted_out_on.isoformat()
    return out


def _deal_brief(d) -> dict[str, Any]:
    out = {
        "chain": d.chain,
        "product": d.product_name,
        "price_czk": d.price_czk,
        "original_czk": d.original_price_czk,
        "discount_pct": d.discount_pct,
        "valid_to": d.valid_to.isoformat() if d.valid_to else None,
        "requires_card": d.requires_card,
        "source": d.source,
    }
    if d.unit_price:
        out["unit_price"] = f"{d.unit_price} Kč/{d.unit_price_unit}"
    if d.nearest_store:
        out["store"] = d.nearest_store.name
        out["distance_m"] = d.nearest_store.distance_m
    return {k: v for k, v in out.items() if v not in (None, False)}


def _schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON schema bez $ref a titulků (vnořené modely rozbalené)."""
    raw = model.model_json_schema()
    defs = raw.pop("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                return resolve(defs[node["$ref"].split("/")[-1]])
            return {k: resolve(v) for k, v in node.items() if k != "title"}
        if isinstance(node, list):
            return [resolve(v) for v in node]
        return node

    return resolve(raw)


async def _publish_cart(ctx: ToolContext, cart) -> None:
    ctx.svc.bus.publish("cart", cart)


# --------------------------------------------------------------------------- vstupy
class GetInventory(BaseModel):
    filter: Literal["all", "expiring", "low", "out"] = "all"


class AddItem(BaseModel):
    name: str = Field(description="Český název, např. 'mléko polotučné'")
    quantity: float = 1
    unit: Literal["ks", "g", "kg", "ml", "l", "bal"] = "ks"
    expires_on: date | None = Field(default=None, description="YYYY-MM-DD, jen když ho uživatel řekl")
    staple: bool = False


class UpdateItem(BaseModel):
    item_id: str
    quantity: float | None = None
    fill_level: float | None = Field(default=None, ge=0, le=1)
    expires_on: date | None = None
    staple: bool | None = None
    min_quantity: float | None = None


class RemoveItem(BaseModel):
    item_id: str
    reason: Literal["consumed", "wasted"] = "consumed"


class ShoppingNeeds(BaseModel):
    horizon_days: int = Field(default=3, ge=0, le=14)


class FindDeals(BaseModel):
    query: str = Field(description="Co hledat, česky: 'máslo', 'kuřecí prsa'")
    max_results: int = Field(default=5, ge=1, le=15)


class PlanShopping(BaseModel):
    items: list[str] = Field(min_length=1, max_length=20, description="Seznam potravin k nákupu")


class NearbyStores(BaseModel):
    chain: str | None = None


class PriceInsightIn(BaseModel):
    query: str


class RohlikSearch(BaseModel):
    query: str
    limit: int = Field(default=5, ge=1, le=10)


class CartItem(BaseModel):
    product_id: str
    quantity: int = Field(default=1, ge=1, le=20)


class RohlikAdd(BaseModel):
    items: list[CartItem] = Field(min_length=1, max_length=25)


class RohlikRemove(BaseModel):
    product_id: str


class Empty(BaseModel):
    pass


class RohlikMore(BaseModel):
    tool: str = Field(description="Název nástroje Rohlík MCP z povoleného seznamu")
    arguments: dict[str, Any] = {}


class SuggestRecipes(BaseModel):
    craving: str | None = Field(default=None, description="Na co má uživatel chuť, když to řekl")


class OrderFood(BaseModel):
    craving: str = Field(description="Kuchyně nebo jídlo: 'pizza', 'sushi', 'něco sladkého'")


class LookInFridge(BaseModel):
    camera_id: Literal["cam0", "cam1"] | None = Field(default=None, description="cam0 = police, cam1 = dveře")


class NotifyUser(BaseModel):
    title: str = Field(max_length=80)
    body: str = Field(max_length=400)


class CallUser(BaseModel):
    reason: str = Field(max_length=300, description="Co Frida v hovoru řekne jako důvod")


class Hangup(BaseModel):
    reason: str | None = None


# --------------------------------------------------------------------------- obsluha
async def h_get_inventory(ctx: ToolContext, a: GetInventory):
    items = ctx.svc.inventory.list()
    if a.filter == "expiring":
        items = [i for i in items if i.status in ("expiring", "expired")]
    elif a.filter == "low":
        items = [i for i in items if i.status in ("low", "out")]
    elif a.filter == "out":
        items = [i for i in items if i.status == "out"]
    summary = ctx.svc.inventory.summary()
    return (
        {"summary": summary.model_dump(), "items": [item_brief(i) for i in items]},
        f"{len(items)} položek",
    )


async def h_add_item(ctx: ToolContext, a: AddItem):
    from ..food.catalog import find_spec

    spec = find_spec(a.name)
    item = ctx.svc.inventory.create(
        InventoryItemCreate(
            name=a.name,
            category=spec.category if spec else "other",
            quantity=a.quantity,
            unit=a.unit,
            expires_on=a.expires_on,
            staple=a.staple,
            shelf=spec.shelf if spec else "unknown",
        ),
        source="agent",
    )
    return item_brief(item), f"Přidáno: {item.name}"


async def h_update_item(ctx: ToolContext, a: UpdateItem):
    patch = InventoryItemUpdate(**a.model_dump(exclude={"item_id"}, exclude_none=True))
    item = ctx.svc.inventory.update(a.item_id, patch)
    if item is None:
        raise ToolError(f"Položka {a.item_id} neexistuje")
    return item_brief(item), f"Upraveno: {item.name}"


async def h_remove_item(ctx: ToolContext, a: RemoveItem):
    item = ctx.svc.inventory.remove(a.item_id, reason=a.reason)
    if item is None:
        raise ToolError(f"Položka {a.item_id} neexistuje")
    return {"removed": item.name, "reason": a.reason}, f"Odebráno: {item.name}"


async def h_shopping_needs(ctx: ToolContext, a: ShoppingNeeds):
    needs = ctx.svc.inventory.shopping_needs(a.horizon_days)
    return {"needs": [item_brief(i) for i in needs]}, f"{len(needs)} věcí k dokoupení"


async def h_find_deals(ctx: ToolContext, a: FindDeals):
    res = await ctx.svc.deals.search(a.query, location=ctx.location)
    deals = [_deal_brief(d) for d in res.deals[: a.max_results]]
    best = res.best
    insight = ctx.svc.deals.insight(a.query, best.price_czk if best else None)
    return (
        {
            "query": a.query,
            "deals": deals,
            "price_verdict": insight.message,
            "sources": res.sources,
            "note": res.note,
        },
        f"{len(res.deals)} akcí" + (f", nejlevněji {best.chain} {czk(best.price_czk)}" if best else ""),
    )


async def _online_prices(ctx: ToolContext, items: list[str]) -> dict[str, float]:
    async def one(q: str) -> tuple[str, float | None]:
        try:
            products = await ctx.svc.grocery.search(q, limit=3)
        except Exception:
            return q, None
        prices = [p.price_czk for p in products if p.in_stock]
        return q, min(prices) if prices else None

    pairs = await asyncio.gather(*(one(q) for q in items))
    return {q: p for q, p in pairs if p is not None}


async def h_plan_shopping(ctx: ToolContext, a: PlanShopping):
    online = await _online_prices(ctx, a.items)
    plans = await ctx.svc.deals.plan(a.items, location=ctx.location, online_prices=online)
    out = []
    for p in plans:
        out.append(
            {
                "strategy": p.strategy,
                "title": p.title,
                "total_czk": p.total_czk,
                "savings_czk": p.savings_czk,
                "travel_km": round((p.travel_m or 0) / 1000, 1),
                "missing": p.missing,
                "stops": [
                    {
                        "chain": s.chain,
                        "store": s.store.name if s.store else None,
                        "items": [
                            f"{i.query}: {czk(i.price_czk)}" for i in s.items if i.price_czk is not None
                        ],
                    }
                    for s in p.stops
                ],
                "explanation": p.explanation,
            }
        )
    best = plans[0] if plans else None
    return {"plans": out}, (f"Nejlepší: {best.title}, {czk(best.total_czk)}" if best else "Žádný plán")


async def h_nearby_stores(ctx: ToolContext, a: NearbyStores):
    stores = await ctx.svc.geo.stores_near(ctx.location)
    if a.chain:
        stores = [s for s in stores if s.chain.lower() == a.chain.lower()]
    return (
        {
            "stores": [
                {
                    "chain": s.chain,
                    "name": s.name,
                    "distance_m": s.distance_m,
                    "address": s.address,
                    "opening_hours": s.opening_hours,
                }
                for s in stores[:12]
            ]
        },
        f"{len(stores)} obchodů v okolí",
    )


async def h_price_insight(ctx: ToolContext, a: PriceInsightIn):
    res = await ctx.svc.deals.search(a.query, location=ctx.location)
    insight = ctx.svc.deals.insight(a.query, res.best.price_czk if res.best else None)
    data = insight.model_dump(mode="json", exclude={"history"})
    return data, insight.message


async def h_rohlik_search(ctx: ToolContext, a: RohlikSearch):
    products = await ctx.svc.grocery.search(a.query, limit=a.limit)
    return (
        {"products": [p.model_dump(mode="json", exclude_none=True, exclude={"image_url"}) for p in products]},
        f"{len(products)} produktů",
    )


async def h_rohlik_add(ctx: ToolContext, a: RohlikAdd):
    cart = await ctx.svc.grocery.add_to_cart([(i.product_id, i.quantity) for i in a.items])
    await _publish_cart(ctx, cart)
    ctx.svc.events.emit(
        "cart_updated",
        "Košík v Rohlíku naplněn",
        detail=f"{len(cart.lines)} položek za {czk(cart.total_czk)}. Objednávku potvrdíš v Rohlíku.",
        severity="success",
        data={"total_czk": cart.total_czk, "mode": cart.mode},
    )
    return _cart_brief(cart), f"Košík: {czk(cart.total_czk)}"


def _cart_brief(cart) -> dict[str, Any]:
    return {
        "mode": cart.mode,
        "lines": [
            {
                "id": line.product.id,
                "name": line.product.name,
                "qty": line.quantity,
                "price_czk": line.product.price_czk,
            }
            for line in cart.lines
        ],
        "total_czk": cart.total_czk,
        "checkout_url": cart.checkout_url,
        "note": "Objednávku a platbu dokončí uživatel sám v Rohlíku.",
    }


async def h_rohlik_cart(ctx: ToolContext, a: Empty):
    cart = await ctx.svc.grocery.cart()
    return _cart_brief(cart), f"Košík: {len(cart.lines)} položek"


async def h_rohlik_remove(ctx: ToolContext, a: RohlikRemove):
    cart = await ctx.svc.grocery.remove_from_cart(a.product_id)
    await _publish_cart(ctx, cart)
    return _cart_brief(cart), "Odebráno z košíku"


async def h_rohlik_checkout(ctx: ToolContext, a: Empty):
    url = await ctx.svc.grocery.checkout_link()
    return {
        "checkout_url": url,
        "note": "Tady uživatel zkontroluje košík, vybere čas doručení a zaplatí.",
    }, "Odkaz na dokončení"


async def h_rohlik_slots(ctx: ToolContext, a: Empty):
    slots = await ctx.svc.grocery.delivery_slots()
    return (
        {
            "slots": [
                {"start": s.start.isoformat(), "end": s.end.isoformat(), "price_czk": s.price_czk}
                for s in slots
                if s.available
            ][:12]
        },
        f"{len(slots)} termínů",
    )


async def h_rohlik_more(ctx: ToolContext, a: RohlikMore):
    from ..grocery.rohlik_mcp import PASSTHROUGH_TOOLS, RohlikMcpProvider

    if not isinstance(ctx.svc.grocery, RohlikMcpProvider):
        raise ToolError("Rohlík není připojený (demo režim).")
    if a.tool not in PASSTHROUGH_TOOLS:
        raise ToolError(f"Nástroj {a.tool} není povolený. Povolené: {', '.join(sorted(PASSTHROUGH_TOOLS))}")
    result = await ctx.svc.grocery.call(a.tool, a.arguments)
    return result, f"Rohlík: {a.tool}"


async def h_suggest_recipes(ctx: ToolContext, a: SuggestRecipes):
    msg, recipes = await ctx.svc.recipes.suggest(
        ctx.svc.inventory.list(), craving=a.craving, prefs=ctx.svc.prefs.get()
    )
    return (
        {
            "message": msg,
            "recipes": [
                {
                    "title": r.title,
                    "minutes": r.minutes,
                    "uses": r.uses,
                    "missing": r.missing,
                    "rescue_score": r.rescue_score,
                    "steps": r.steps,
                }
                for r in recipes
            ],
        },
        f"{len(recipes)} receptů",
    )


async def h_order_food(ctx: ToolContext, a: OrderFood):
    venues = await delivery_options(ctx.svc.delivery, a.craving, ctx.location)
    return (
        {
            "venues": [v.model_dump(mode="json", exclude_none=True, exclude={"image_url"}) for v in venues],
            "note": "Objednává se v aplikaci Wolt nebo foodora, Frida jen nabídne odkaz.",
        },
        f"{len(venues)} možností",
    )


async def h_look(ctx: ToolContext, a: LookInFridge):
    ids = [a.camera_id] if a.camera_id else list(ctx.svc.cameras.cameras)
    seen = []
    for cam_id in ids:
        obs = await ctx.svc.cameras.capture(cam_id, reason="manual")
        if obs is None:
            seen.append({"camera_id": cam_id, "error": "kamera neodpověděla"})
            continue
        seen.append(
            {
                "camera_id": cam_id,
                "image_url": obs.image_url,
                "provider": obs.provider,
                "items": [
                    {
                        "label": d.label,
                        "confidence": round(d.confidence, 2),
                        "fill": d.fill_level,
                        "expiry": d.expiry_text,
                    }
                    for d in obs.detections
                ],
                "note": obs.note,
            }
        )
    total = sum(len(s.get("items", [])) for s in seen)
    return {"cameras": seen}, f"Vidím {total} věcí"


async def h_notify(ctx: ToolContext, a: NotifyUser):
    n = ctx.svc.notify.record("push", a.title, a.body, status="sent")
    return {"id": n.id, "status": n.status}, "Upozornění odesláno"


async def h_call(ctx: ToolContext, a: CallUser):
    n = await ctx.svc.notify.call(a.reason)
    return {"status": n.status, "reason": n.reason}, {"sent": "Volám", "simulated": "Hovor (simulace)"}.get(
        n.status, "Hovor neproběhl"
    )


async def h_hangup(ctx: ToolContext, a: Hangup):
    ctx.hangup = True
    ctx.hangup_reason = a.reason or "konec"
    return {"ok": True, "note": "Hovor se ukončí po dořečení této odpovědi."}, "Zavěšuji"


async def h_location(ctx: ToolContext, a: Empty):
    label = ctx.location.label or await ctx.svc.geo.reverse(ctx.location)
    return {
        "lat": round(ctx.location.lat, 4),
        "lon": round(ctx.location.lon, 4),
        "label": label,
        "source": ctx.location.source,
    }, label


class ToolError(Exception):
    pass


# --------------------------------------------------------------------------- registr
TOOLS: tuple[Tool, ...] = (
    Tool(
        "get_inventory",
        "Obsah lednice: položky, množství, stav (ok/low/out/expiring/expired), trvanlivost.",
        GetInventory,
        h_get_inventory,
        lambda a: "Dívám se do inventáře",
    ),
    Tool(
        "add_item",
        "Přidá potravinu do lednice (když ji uživatel nahlásí ručně).",
        AddItem,
        h_add_item,
        lambda a: f"Přidávám {a.get('name', '')}",
    ),
    Tool(
        "update_item",
        "Upraví položku: množství, hladinu, datum spotřeby, zda je to základní potravina.",
        UpdateItem,
        h_update_item,
        lambda a: "Upravuji položku",
    ),
    Tool(
        "remove_item",
        "Odebere položku (snědeno = consumed, vyhozeno = wasted).",
        RemoveItem,
        h_remove_item,
        lambda a: "Odebírám položku",
    ),
    Tool(
        "get_shopping_needs",
        "Co dokoupit: došlé a docházející základní potraviny a co podle spotřeby brzy dojde.",
        ShoppingNeeds,
        h_shopping_needs,
        lambda a: "Zjišťuji, co dochází",
    ),
    Tool(
        "find_deals",
        "Akce na potravinu v obchodech v okolí (Albert, Lidl, Billa, Kaufland, Penny...). "
        "Vrací cenu, slevu, platnost, nejbližší pobočku a hodnocení ceny podle historie.",
        FindDeals,
        h_find_deals,
        lambda a: f"Hledám akce: {a.get('query', '')}",
    ),
    Tool(
        "plan_shopping",
        "Naplánuje nákup seznamu potravin: nejlevnější rozdělení mezi obchody, vše v jednom, "
        "nebo dovoz z Rohlíku. Počítá i cestu.",
        PlanShopping,
        h_plan_shopping,
        lambda a: "Plánuji nákup",
    ),
    Tool(
        "nearby_stores",
        "Obchody s potravinami v okolí uživatele.",
        NearbyStores,
        h_nearby_stores,
        lambda a: "Hledám obchody v okolí",
    ),
    Tool(
        "price_insight",
        "Je aktuální cena dobrá? Porovná nejlepší akci s historií cen za 90 dní.",
        PriceInsightIn,
        h_price_insight,
        lambda a: f"Hodnotím cenu: {a.get('query', '')}",
    ),
    Tool(
        "rohlik_search",
        "Hledá produkty v Rohlíku (online nákup s dovozem).",
        RohlikSearch,
        h_rohlik_search,
        lambda a: f"Hledám v Rohlíku: {a.get('query', '')}",
    ),
    Tool(
        "rohlik_add_to_cart",
        "Přidá produkty do košíku v Rohlíku. Nic neobjednává ani neplatí.",
        RohlikAdd,
        h_rohlik_add,
        lambda a: "Plním košík v Rohlíku",
    ),
    Tool("rohlik_get_cart", "Aktuální košík v Rohlíku.", Empty, h_rohlik_cart, lambda a: "Kontroluji košík"),
    Tool(
        "rohlik_remove_from_cart",
        "Odebere produkt z košíku v Rohlíku.",
        RohlikRemove,
        h_rohlik_remove,
        lambda a: "Odebírám z košíku",
    ),
    Tool(
        "rohlik_checkout_link",
        "Odkaz, kde uživatel sám zkontroluje košík, vybere doručení a zaplatí.",
        Empty,
        h_rohlik_checkout,
        lambda a: "Připravuji odkaz na dokončení",
    ),
    Tool(
        "rohlik_delivery_slots",
        "Volné termíny doručení Rohlíku.",
        Empty,
        h_rohlik_slots,
        lambda a: "Zjišťuji termíny doručení",
    ),
    Tool(
        "rohlik_more",
        "Další nástroje Rohlík MCP (slevy, recepty, oblíbené, historie objednávek). "
        "Jen čtecí nástroje z povoleného seznamu, žádné rušení objednávek.",
        RohlikMore,
        h_rohlik_more,
        lambda a: f"Rohlík: {a.get('tool', '')}",
        live_only=True,
    ),
    Tool(
        "suggest_recipes",
        "Recepty z toho, co je v lednici, přednostně z věcí, kterým končí trvanlivost.",
        SuggestRecipes,
        h_suggest_recipes,
        lambda a: "Vymýšlím, co uvařit",
    ),
    Tool(
        "order_food_nearby",
        "Možnosti rozvozu jídla (Wolt, foodora) pro danou chuť. Vrací odkazy, neobjednává.",
        OrderFood,
        h_order_food,
        lambda a: f"Hledám rozvoz: {a.get('craving', '')}",
    ),
    Tool(
        "look_in_fridge",
        "Vyfotí lednici kamerou a řekne, co je vidět. Bateriové kamery tím probudíš, "
        "používej jen když je to potřeba.",
        LookInFridge,
        h_look,
        lambda a: "Dívám se kamerou",
    ),
    Tool(
        "notify_user",
        "Pošle tichou notifikaci do aplikace.",
        NotifyUser,
        h_notify,
        lambda a: "Posílám upozornění",
    ),
    Tool(
        "call_user",
        "Zavolá uživateli na telefon (jen když o to požádá nebo je to naléhavé).",
        CallUser,
        h_call,
        lambda a: "Volám ti",
        channels=("text",),
    ),
    Tool(
        "zavesit",
        "Ukončí telefonní hovor. Použij, když se uživatel loučí nebo je hotovo.",
        Hangup,
        h_hangup,
        lambda a: "Zavěšuji",
        channels=("voice",),
    ),
    Tool(
        "get_location",
        "Kde uživatel je (pro hledání obchodů a rozvozu).",
        Empty,
        h_location,
        lambda a: "Zjišťuji polohu",
    ),
)

BY_NAME = {t.name: t for t in TOOLS}


def tools_for(channel: str, *, rohlik_live: bool) -> list[Tool]:
    return [t for t in TOOLS if channel in t.channels and (rohlik_live or not t.live_only)]


def tool_definitions(channel: str, *, rohlik_live: bool, eager: bool = True) -> list[dict[str, Any]]:
    defs = []
    for t in tools_for(channel, rohlik_live=rohlik_live):
        d: dict[str, Any] = {"name": t.name, "description": t.description, "input_schema": _schema(t.model)}
        if eager:
            d["eager_input_streaming"] = True
        defs.append(d)
    return defs


def _dump(result: Any) -> str:
    text = json.dumps(result, ensure_ascii=False, default=str)
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + '…"(zkráceno)"'
    return text


async def run_tool(
    ctx: ToolContext,
    name: str,
    raw_input: Any,
    tool_use_id: str,
    on_tool: Callable[[ToolCallInfo], None] | None = None,
) -> dict[str, Any]:
    """Spustí nástroj a vrátí blok `tool_result`. Chyby vrací jako `is_error`, nikdy nevyhazuje."""
    tool = BY_NAME.get(name)
    raw = raw_input if isinstance(raw_input, dict) else {}
    info = ToolCallInfo(
        id=tool_use_id,
        name=name,
        title=tool.title(raw) if tool else name,
        input=raw,
        status="running",
    )
    ctx.tool_calls.append(info)
    if on_tool:
        on_tool(info)

    def finish(status: str, summary: str, content: str, is_error: bool = False) -> dict[str, Any]:
        info.status = status  # type: ignore[assignment]
        info.summary = summary
        if on_tool:
            on_tool(info)
        block: dict[str, Any] = {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
        if is_error:
            block["is_error"] = True
        return block

    if tool is None or ctx.channel not in tool.channels:
        return finish("error", "Neznámý nástroj", f"Nástroj {name} tu není k dispozici.", True)
    if not isinstance(raw_input, dict):
        return finish("error", "Neplatný vstup", json.dumps({"INVALID_JSON": str(raw_input)[:500]}), True)
    try:
        args = tool.model.model_validate(raw_input)
    except ValidationError as exc:
        return finish(
            "error",
            "Neplatný vstup",
            json.dumps({"INVALID_INPUT": exc.errors(include_url=False, include_context=False)}, default=str),
            True,
        )
    try:
        result, summary = await tool.handler(ctx, args)
    except ToolError as exc:
        return finish("error", str(exc), str(exc), True)
    except Exception as exc:
        log.exception("nástroj %s selhal", name)
        return finish("error", "Chyba", f"Nástroj selhal: {type(exc).__name__}: {str(exc)[:300]}", True)
    return finish("done", summary, _dump(result))
