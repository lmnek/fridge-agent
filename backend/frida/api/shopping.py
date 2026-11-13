"""REST: akce, obchody, plán nákupu, Rohlík, recepty, chutě, čárové kódy."""

from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..grocery.base import GroceryError
from ..schemas import (
    Cart,
    CravingAnswer,
    DealSearchResult,
    DeliverySlot,
    GeoPoint,
    GroceryProduct,
    InventoryItem,
    InventoryItemUpdate,
    PriceInsight,
    RecipeSuggestion,
    ShoppingPlan,
    Store,
)
from ..services import Services
from ..text import czk
from .deps import get_svc

router = APIRouter(prefix="/api")
Svc = Annotated[Services, Depends(get_svc)]


def _here(svc: Services, lat: float | None = None, lon: float | None = None) -> GeoPoint:
    if lat is not None and lon is not None:
        return GeoPoint(lat=lat, lon=lon, source="manual")
    return svc.prefs.location


# ----------------------------------------------------------------- akce
@router.get("/deals", response_model=DealSearchResult)
async def deals(q: str, svc: Svc, lat: float | None = None, lon: float | None = None) -> DealSearchResult:
    if not q.strip():
        raise HTTPException(400, "Zadej, co hledáš")
    return await svc.deals.search(q.strip(), location=_here(svc, lat, lon))


@router.get("/deals/insight", response_model=PriceInsight)
async def insight(q: str, svc: Svc) -> PriceInsight:
    res = await svc.deals.search(q, location=svc.prefs.location)
    return svc.deals.insight(q, res.best.price_czk if res.best else None)


@router.get("/deals/for-needs", response_model=list[DealSearchResult])
async def deals_for_needs(svc: Svc) -> list[DealSearchResult]:
    """Akce na všechno, co dochází (pro přehled „co se teď vyplatí koupit“)."""
    needs = svc.inventory.shopping_needs()
    names = list(dict.fromkeys(i.name for i in needs))[:12]
    found = await svc.deals.search_many(names, location=svc.prefs.location)
    return list(found.values())


class PlanIn(BaseModel):
    items: list[str] = Field(default_factory=list, max_length=25)
    include_online: bool = True


async def _online_prices(svc: Services, items: list[str]) -> dict[str, float]:
    async def one(q: str) -> tuple[str, float | None]:
        try:
            products = await svc.grocery.search(q, limit=3)
        except Exception:
            return q, None
        prices = [p.price_czk for p in products if p.in_stock]
        return q, min(prices) if prices else None

    pairs = await asyncio.gather(*(one(q) for q in items))
    return {q: p for q, p in pairs if p is not None}


@router.post("/deals/plan", response_model=list[ShoppingPlan])
async def plan(body: PlanIn, svc: Svc) -> list[ShoppingPlan]:
    items = body.items or list(dict.fromkeys(i.name for i in svc.inventory.shopping_needs()))
    if not items:
        return []
    online = await _online_prices(svc, items) if body.include_online else None
    return await svc.deals.plan(items, location=svc.prefs.location, online_prices=online)


@router.get("/shopping/needs", response_model=list[InventoryItem])
async def needs(svc: Svc, horizon_days: int = 3) -> list[InventoryItem]:
    return svc.inventory.shopping_needs(horizon_days)


@router.get("/stores", response_model=list[Store])
async def stores(
    svc: Svc, lat: float | None = None, lon: float | None = None, radius: int | None = None
) -> list[Store]:
    return await svc.geo.stores_near(_here(svc, lat, lon), radius)


# ----------------------------------------------------------------- Rohlík
def _grocery_error(exc: Exception) -> HTTPException:
    return HTTPException(502, f"Rohlík: {exc}")


@router.get("/grocery/cart", response_model=Cart)
async def cart(svc: Svc) -> Cart:
    try:
        return await svc.grocery.cart()
    except GroceryError as exc:
        raise _grocery_error(exc) from exc


@router.get("/grocery/search", response_model=list[GroceryProduct])
async def grocery_search(q: str, svc: Svc, limit: int = 8) -> list[GroceryProduct]:
    try:
        return await svc.grocery.search(q, limit=min(limit, 20))
    except GroceryError as exc:
        raise _grocery_error(exc) from exc


class CartItemIn(BaseModel):
    product_id: str
    quantity: int = Field(default=1, ge=1, le=20)


class CartAddIn(BaseModel):
    items: list[CartItemIn] = Field(min_length=1, max_length=25)


def _cart_changed(svc: Services, cart: Cart, title: str) -> Cart:
    svc.bus.publish("cart", cart)
    svc.events.emit(
        "cart_updated",
        title,
        detail=f"{len(cart.lines)} položek za {czk(cart.total_czk)}. Objednávku potvrdíš v Rohlíku.",
        severity="success",
        data={"total_czk": cart.total_czk, "mode": cart.mode},
    )
    return cart


@router.post("/grocery/cart", response_model=Cart)
async def cart_add(body: CartAddIn, svc: Svc) -> Cart:
    try:
        cart = await svc.grocery.add_to_cart([(i.product_id, i.quantity) for i in body.items])
    except GroceryError as exc:
        raise _grocery_error(exc) from exc
    return _cart_changed(svc, cart, "Košík v Rohlíku upraven")


@router.delete("/grocery/cart/{product_id}", response_model=Cart)
async def cart_remove(product_id: str, svc: Svc) -> Cart:
    try:
        cart = await svc.grocery.remove_from_cart(product_id)
    except GroceryError as exc:
        raise _grocery_error(exc) from exc
    svc.bus.publish("cart", cart)
    return cart


@router.post("/grocery/fill-needs", response_model=Cart)
async def fill_needs(svc: Svc) -> Cart:
    """Jedním klikem: všechno, co dochází, najde v Rohlíku a dá do košíku. Neobjednává."""
    names = list(dict.fromkeys(i.name for i in svc.inventory.shopping_needs()))[:15]
    if not names:
        return await svc.grocery.cart()

    async def first(q: str) -> str | None:
        try:
            products = [p for p in await svc.grocery.search(q, limit=3) if p.in_stock]
        except GroceryError:
            return None
        return min(products, key=lambda p: p.price_czk).id if products else None

    ids = [i for i in await asyncio.gather(*(first(n) for n in names)) if i]
    if not ids:
        return await svc.grocery.cart()
    try:
        cart = await svc.grocery.add_to_cart([(i, 1) for i in ids])
    except GroceryError as exc:
        raise _grocery_error(exc) from exc
    return _cart_changed(svc, cart, f"Frida dala do košíku {len(ids)} věcí, které dochází")


@router.get("/grocery/checkout")
async def checkout(svc: Svc) -> dict:
    return {"url": await svc.grocery.checkout_link(), "note": "Objednávku a platbu dokončíš v Rohlíku."}


@router.get("/grocery/slots", response_model=list[DeliverySlot])
async def slots(svc: Svc) -> list[DeliverySlot]:
    try:
        return await svc.grocery.delivery_slots()
    except GroceryError as exc:
        raise _grocery_error(exc) from exc


@router.get("/grocery/discounted", response_model=list[GroceryProduct])
async def discounted(svc: Svc) -> list[GroceryProduct]:
    try:
        return await svc.grocery.discounted(limit=20)
    except GroceryError as exc:
        raise _grocery_error(exc) from exc


# ----------------------------------------------------------------- jídlo
@router.get("/recipes")
async def recipes(svc: Svc, craving: str | None = None) -> dict:
    msg, items = await svc.recipes.suggest(svc.inventory.list(), craving=craving, prefs=svc.prefs.get())
    return {"message": msg, "recipes": [r.model_dump(mode="json") for r in items]}


class CravingIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    location: GeoPoint | None = None


@router.post("/craving", response_model=CravingAnswer)
async def craving(body: CravingIn, svc: Svc) -> CravingAnswer:
    return await svc.recipes.craving(
        body.text, svc.inventory.list(), location=body.location or svc.prefs.location, prefs=svc.prefs.get()
    )


@router.post("/recipes/{recipe_id}/cooked")
async def cooked(recipe_id: str, body: RecipeSuggestion, svc: Svc) -> dict:
    """Uvařeno: odečte použité suroviny z lednice (každou o kus nebo o třetinu hladiny)."""
    used = []
    for item_id in body.uses_item_ids:
        item = svc.inventory.get(item_id)
        if item is None:
            continue
        if item.fill_level is not None:
            level = round(item.fill_level - 0.33, 2)
            if level <= 0.05:
                svc.inventory.remove(item_id, reason="consumed")
            else:
                svc.inventory.update(item_id, InventoryItemUpdate(fill_level=level))
        elif item.unit in ("ks", "bal"):
            svc.inventory.consume(item_id, 1)
        else:
            svc.inventory.consume(item_id, item.quantity / 3)
        used.append(item.name)
    svc.events.emit(
        "item_changed", f"Uvařeno: {body.title}", detail=", ".join(used) or None, severity="success"
    )
    return {"ok": True, "used": used}


@router.get("/barcode/{ean}")
async def barcode(ean: str, svc: Svc) -> dict:
    found = await svc.barcode.lookup(ean)
    if not found:
        raise HTTPException(404, "Výrobek s tímto kódem neznám")
    return found
