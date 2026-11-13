"""Tools that put the order on the stage panel: show_cart (C4) and show_shops (C3). Part 3, the brain.

The real Rohlík cart lives on OpenAI's side of the MCP call and has no reasons, so the model also calls
show_cart with every item, and that publishes the `cart` event. show_shops publishes `deals`: today's
prices and deals around the flat, which part 8 scrapes into data/deals.json in the same shape.
Event shapes: docs/handoffs/README.md.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

import deals as leaflets  # part 8's scraper (bridge/deals.py)
import main as bridge  # main imports this module after emit and STATE exist
from rohlik import Rohlik, _num, _products_of, read_products, set_cart

router = APIRouter()


class CartLine(BaseModel):
    name: str
    qty: float | None = None  # default: the pick's usual quantity
    price_czk: float | None = None  # per unit, only used for an item with no pick
    reason: str = ""


class Cart(BaseModel):
    items: list[CartLine]


class Shops(BaseModel):
    choice: str = "Rohlík"
    why: str = ""


def _pick(name: str) -> dict[str, str]:
    """The product pick for a cart line: the same item name, else the longest pick name inside it (or it inside one)."""
    key = name.strip().lower()
    rows = [r for r in read_products() if r.get("Item")]
    exact = [r for r in rows if r["Item"].lower() == key]
    near = sorted(
        (r for r in rows if r["Item"].lower() in key or key in r["Item"].lower()), key=lambda r: -len(r["Item"])
    )
    return (exact or near or [{}])[0]


def _live(pick: dict[str, str]) -> float | None:
    """Today's Rohlík price for a pick from part 8's scrape (bridge/deals.py), so the card matches the real cart."""
    return deals().get("rohlik_prices", {}).get(_col(pick, "product id"))


def _col(row: dict[str, str], prefix: str) -> str:
    return next((v for k, v in row.items() if k.lower().startswith(prefix)), "")


@router.post("/tools/show_cart")
def tool_show_cart(cart: Cart, background: BackgroundTasks) -> dict[str, Any]:
    """The model sends names, quantities and reasons. Prices and pictures come from the picks, so its call is short
    (C's silent step before the narration) and a pick's price can't drift."""
    items = []
    for line in cart.items:
        pick = _pick(line.name)
        items.append(
            {
                "name": line.name,
                "qty": line.qty if line.qty is not None else (_num(_col(pick, "qty")) or 1),
                "price_czk": _live(pick) or _num(_col(pick, "price")) if pick else (line.price_czk or 0),
                "reason": line.reason,
                "image_url": _col(pick, "image").strip("<>"),
            }
        )
    total = round(sum(i["price_czk"] * i["qty"] for i in items))
    # HACK(demo): without a Rohlík token this is also the fake cart that place_order puts up for approval.
    bridge.STATE["cart"] = items
    bridge.save()
    bridge.emit("cart", items=items, total_czk=total)
    if bridge.ROHLIK_TOKEN:  # part 5: the real cart, filled by the bridge after this reply, so nobody waits on it
        picks = [(_col(_pick(i["name"]), "product id"), max(1, round(i["qty"]))) for i in items]
        background.add_task(fill_rohlik, [(int(pid), qty) for pid, qty in picks if pid.isdigit()])
    return {"ok": True, "total_czk": total}


async def fill_rohlik(lines: list[tuple[int, int]]) -> None:
    """Puts show_cart's items with a product pick into the real Rohlík cart. The model never has to call
    add_items_to_cart, which it skipped in the 15:00 rehearsal, and the order turn has no MCP round for it."""
    t0 = time.monotonic()
    try:
        res = await set_cart(lines)
    except Exception as e:  # the narration already ran, so only the stage hears about it
        print(f"[rohlik] filling the real cart failed: {e}")
        bridge.emit("rohlik_cart", ok=False, error=str(e)[:300])
        return
    seconds = round(time.monotonic() - t0, 1)
    print(f"[rohlik] real cart: {res['products']} products, {res['total_czk']} Kč, filled in {seconds} s")
    bridge.emit("rohlik_cart", ok=True, seconds=seconds, **res)


# --------------------------------------------------------------------------- deals (C3)

# HACK(demo): a hand-made sample until part 8's scrape lands in data/deals.json. Rohlík prices follow products.md
# (per pack or piece). The banana sale is staged: Rohlík had none on 13. 11.
SAMPLE: dict[str, Any] = {
    "scraped_at": "sample",
    "stores": [
        {"name": "Rohlík", "distance_m": None, "delivery_min": 60},
        {"name": "Lidl", "distance_m": 400},
        {"name": "Albert", "distance_m": 700},
    ],
    "items": [
        {"item": "Lactose-free milk", "store": "Rohlík", "price_czk": 47.9, "was_czk": None},
        {"item": "Lactose-free milk", "store": "Lidl", "price_czk": 39.9, "was_czk": None},
        {"item": "Lactose-free milk", "store": "Albert", "price_czk": 44.9, "was_czk": None},
        {"item": "Eggs", "store": "Rohlík", "price_czk": 64.9, "was_czk": None},
        {"item": "Eggs", "store": "Lidl", "price_czk": 59.9, "was_czk": None},
        {"item": "Eggs", "store": "Albert", "price_czk": 69.9, "was_czk": None},
        {"item": "Guanciale", "store": "Rohlík", "price_czk": 58.9, "was_czk": None},
        {"item": "Spaghetti", "store": "Rohlík", "price_czk": 64.9, "was_czk": None},
        {"item": "Spaghetti", "store": "Lidl", "price_czk": 49.9, "was_czk": 59.9},
        {"item": "Spaghetti", "store": "Albert", "price_czk": 59.9, "was_czk": None},
        {"item": "Gluten-free spaghetti", "store": "Rohlík", "price_czk": 95.9, "was_czk": None},
        {"item": "Gluten-free spaghetti", "store": "Albert", "price_czk": 99.9, "was_czk": None},
        {"item": "Greek yogurt", "store": "Rohlík", "price_czk": 22.9, "was_czk": None},
        {"item": "Greek yogurt", "store": "Lidl", "price_czk": 19.9, "was_czk": None},
        {"item": "Greek yogurt", "store": "Albert", "price_czk": 24.9, "was_czk": None},
        {"item": "Bananas", "store": "Rohlík", "price_czk": 9.68, "was_czk": 12.1},
        {"item": "Bananas", "store": "Lidl", "price_czk": 10.9, "was_czk": None},
        {"item": "Bananas", "store": "Albert", "price_czk": 11.5, "was_czk": None},
    ],
}


SAVED = bridge.ROOT / "replay" / "deals.json"  # part 8's committed scrape


def deals() -> dict[str, Any]:
    """Part 8's scrape (bridge/deals.py), else its committed copy, else the sample."""
    for path in (bridge.DATA_DIR / "deals.json", SAVED):
        if path.exists():
            return json.loads(path.read_text())
    return SAMPLE


def deals_markdown() -> str:
    """Today's sales for the household memory, so the model knows them before it plans the order."""
    d = deals()
    sales = [
        f"- {i['item']} at {i['store']}: {i['price_czk']:g} Kč, was {i['was_czk']:g} Kč "
        f"(-{round(100 - 100 * i['price_czk'] / i['was_czk'])} %)."
        for i in d["items"]
        if i.get("was_czk")
    ]
    shops = ", ".join(f"{s['name']} {s['distance_m']} m" for s in nearby_shops()["shops"])
    return (
        "# Today's deals\n\nScraped prices around the flat. On sale today:\n\n"
        + "\n".join(sales or ["- nothing"])
        + (f"\n\nNearest shops: {shops}. Rohlík delivers within the hour." if shops else "")
        + "\n\nCheapest near the flat today (shop leaflets): "
        + "; ".join(
            f"{c['item']} at {c['store']} ({c['distance_m']} m), {c['price_czk']:g} Kč for {c['product']}"
            for c in d.get("sales", [])
        )
        + "."
        + "\n\nRohlík prices today: "
        + "; ".join(
            f"{r['Item']} {_live(r) or _num(_col(r, 'price')):g} Kč ({_col(r, 'rohlík product').split(',')[-1].strip()})"
            for r in read_products()
            if r.get("Item")
        )
        + "."
    )


@router.post("/tools/show_shops")
def tool_show_shops(shops: Shops) -> dict[str, Any]:
    d = deals()
    bridge.emit("deals", **d, choice=shops.choice, why=shops.why)
    # The prices back to the model too, so "how much are eggs today?" gets an answer and not only a card.
    prices = [{k: i.get(k) for k in ("item", "store", "price_czk", "was_czk")} for i in d["items"]]
    stores = [{"name": st["name"], "distance_m": st.get("distance_m")} for st in d["stores"]]  # the real nearest shop
    return {"ok": True, "shown": True, "scraped_at": d.get("scraped_at"), "stores": stores, "prices": prices}


class ProductAsk(BaseModel):
    item: str
    query_cs: str = ""
    where: str = "shops"  # "rohlik": the Rohlík product and price, "shops": the cheapest shop near the flat


@router.post("/tools/show_product")
async def tool_show_product(ask: ProductAsk) -> dict[str, Any]:
    """A small product card on the kitchen screen: where the food is cheapest near the flat today, from the shops'
    leaflets (akcniceny.cz). Staples are saved ahead by the scrape and instant, anything else is searched now."""
    name = ask.item.strip()
    best = None
    if ask.where.lower() != "rohlik":
        best = next((s for s in deals().get("sales", []) if s["item"].lower() == name.lower()), None)
    if not best and ask.where.lower() != "rohlik":
        best = await asyncio.to_thread(leaflets.search_live, ask.query_cs.strip() or name)
    if not best:  # no shop has it in a leaflet this week: Rohlík has nearly everything
        hit = await rohlik_find(ask.query_cs.strip() or name)
        if not hit:
            return {"ok": False, "error": f"Couldn't find {name} anywhere today."}
        best = {**hit, "store": "Rohlík", "distance_m": None, "was_czk": None}
    card = {**best, "item": name[:1].upper() + name[1:]}
    bridge.emit("product", **card)
    return {"ok": True, **{k: card.get(k) for k in ("item", "product", "store", "distance_m", "price_czk", "was_czk")}}


async def rohlik_find(query: str) -> dict[str, Any] | None:
    """The first Rohlík hit for a food, with its photo from the product page. About 0.7 s."""
    try:
        async with Rohlik() as r:
            raw = await r.call("batch_search_products", {"queries": [{"keyword": query}]})
    except Exception:
        return None
    hits = [h for h in _products_of(raw) if h.get("price") and h.get("inStock", True)]
    if not hits:
        return None
    # Rohlík's first hit can miss the brand ("Dacello pražská šunka" -> tlačenka): take the hit that has the most
    # of the asked words, the search order breaks ties.
    words = [w[: max(4, len(w) - 2)].lower() for w in query.split() if len(w) > 2]
    score = {id(h): sum(w in str(h.get("productName", "")).lower() for w in words) for h in hits[:30]}
    best = max(score.values())
    # Among the products that match the asked words best, the cheapest one (per kg or l where Rohlík says).
    fits = [h for h in hits[:30] if score[id(h)] == best]
    hit = min(fits, key=lambda h: (h.get("pricePerUnit") or {}).get("full") or h["price"])
    pid = hit.get("productId")
    image = ""
    try:
        import re

        import httpx

        async with httpx.AsyncClient(timeout=3, follow_redirects=True) as c:
            html = (await c.get(f"https://www.rohlik.cz/{pid}", headers={"User-Agent": "Mozilla/5.0"})).text
        m = re.search(rf"https://cdn\.rohlik\.cz/images/grocery/products/{pid}/[^\"'\s?]+\.(?:jpg|png|webp)", html)
        image = m.group(0) if m else ""
    except Exception:
        pass
    return {"id": pid, "product": hit.get("productName", ""), "price_czk": hit.get("price"), "image_url": image}


# HACK(demo): a simulated order, filled by voice ("add red peppers to my order"). Never touches the real cart.
ORDER: list[dict[str, Any]] = []


class OrderAdd(BaseModel):
    item: str
    query_cs: str = ""
    qty: int = 1


def _order_event(added: Any = None) -> dict[str, Any]:
    total = round(sum(i["price_czk"] * i["qty"] for i in ORDER), 2)
    # The named foods are the order: place_order's approval lists exactly these (bridge.STATE["cart"]).
    bridge.STATE["cart"] = [
        {"name": i["item"], "product": i["product"], "qty": i["qty"], "price_czk": i["price_czk"],
         "image_url": i["image_url"], "reason": "you asked"}
        for i in ORDER
    ]
    bridge.save()
    bridge.emit("order", items=ORDER, added=added, total_czk=total)
    return {"items": [f"{i['qty']}x {i['item']}" for i in ORDER], "total_czk": total}


@router.post("/tools/add_to_order")
async def tool_add_to_order(add: OrderAdd) -> dict[str, Any]:
    found = await rohlik_find(add.query_cs.strip() or add.item)
    if not found:
        return {"ok": False, "error": f"Couldn't find {add.item} on Rohlík."}
    same = next((i for i in ORDER if i["id"] == found["id"]), None)
    if same:
        same["qty"] += max(1, add.qty)
    else:
        ORDER.append({**found, "item": add.item[:1].upper() + add.item[1:], "qty": max(1, add.qty)})
    if bridge.ROHLIK_TOKEN:  # part 5: the real Rohlík cart gets it too (cart only, the order needs a human tap)
        asyncio.create_task(fill_rohlik([(int(i["id"]), i["qty"]) for i in ORDER]))
    return {"ok": True, "added": found["product"], "price_czk": found["price_czk"], **_order_event(found["id"])}


@router.post("/tools/remove_from_order")
def tool_remove_from_order(add: OrderAdd) -> dict[str, Any]:
    name = add.item.lower()
    ORDER[:] = [i for i in ORDER if name not in i["item"].lower() and name not in i["product"].lower()]
    return {"ok": True, **_order_event()}


@router.post("/tools/show_order")
def tool_show_order() -> dict[str, Any]:
    return {"ok": True, **_order_event()}


@router.post("/tools/call_courier")
async def tool_call_courier() -> dict[str, Any]:
    """Coldex phones the courier (part 6, bridge/courier.py). The kitchen plays both sides of the call."""
    import courier
    from fastapi import HTTPException

    try:
        return await courier.call()
    except HTTPException as e:
        return {"ok": False, "error": str(e.detail)}


def nearby_shops() -> dict[str, Any]:
    """HACK(demo): the flat's nearest store of each chain, from OpenStreetMap, fixed in bridge/replay/stores.json."""
    saved = json.loads((bridge.ROOT / "replay" / "stores.json").read_text())
    shops = sorted(saved["stores"].values(), key=lambda s: s["distance_m"])[:6]
    return {"home": {"lat": saved["lat"], "lon": saved["lon"]}, "shops": shops}


@router.post("/tools/show_nearby")
def tool_show_nearby() -> dict[str, Any]:
    n = nearby_shops()
    bridge.emit("nearby", **n)
    return {"ok": True, "shops": [{"name": s["name"], "distance_m": s["distance_m"]} for s in n["shops"]]}


TOOLS = [
    bridge._fn(
        "show_cart",
        "Show the cart on the panel, with every item and its reason. Call it once per order with the whole cart. "
        "Prices and pictures of the product picks are added for you.",
        {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "The pick's item name, e.g. 'Lactose-free milk'."},
                        "qty": {"type": "number"},
                        "reason": {"type": "string", "description": "One reason tag from the instructions."},
                        "price_czk": {
                            "type": "number",
                            "description": "Only for an item with no pick: your guess per unit.",
                        },
                    },
                    "required": ["name", "qty", "reason"],
                },
            }
        },
        ["items"],
    ),
    bridge._fn(
        "add_to_order",
        "Add one food to the order on the kitchen screen. Call it whenever someone asks to add, buy or order a food, "
        "once per food, in the same response as a short spoken confirmation.",
        {
            "item": {"type": "string", "description": "The food in English, e.g. 'Red pepper'."},
            "query_cs": {"type": "string", "description": "The food in Czech as they said it, with the brand if any, e.g. 'paprika červená'."},
            "qty": {"type": "integer", "description": "How many, 1 if they didn't say."},
        },
        ["item", "query_cs"],
    ),
    bridge._fn(
        "remove_from_order",
        "Remove one food from the order on the kitchen screen.",
        {"item": {"type": "string", "description": "The food in English."}},
        ["item"],
    ),
    bridge._fn(
        "show_order",
        "Show the order so far on the kitchen screen, for 'what's in my order?'. Returns the items and the total.",
        {},
    ),
    bridge._fn(
        "call_courier",
        "Pick up the Rohlík courier's phone call about the order. A second voice of yours talks to them, and the "
        "kitchen hears both sides. Call it for any ask about a phone call, after 'That's the courier calling, I'll "
        "pick up.' Then stay quiet until the call ends.",
        {},
    ),
    bridge._fn(
        "show_nearby",
        "Show the shops near the flat on a map on the kitchen screen. Call it when someone asks what shops are "
        "nearby, in the same response as your spoken answer.",
        {},
    ),
    bridge._fn(
        "show_product",
        "Show where one food is cheapest near the flat today, with its photo, price and shop, on the kitchen "
        "screen. Call it for a question about one food's price or where it is cheapest.",
        {
            "item": {"type": "string", "description": "The food in English, e.g. 'Tomatoes' or 'Butter'."},
            "query_cs": {"type": "string", "description": "The same food in Czech for the shop leaflets, e.g. 'rajčata'."},
            "where": {
                "type": "string",
                "enum": ["shops", "rohlik"],
                "description": "rohlik when they ask about Rohlík, shops (the cheapest shop near the flat) otherwise.",
            },
        },
        ["item"],
    ),
    bridge._fn(
        "show_shops",
        "Show where to buy on the panel: today's prices and deals across Rohlík and the nearby shops, and your pick. "
        "Call it during an order, not for a single price question (that's show_product).",
        {
            "choice": {"type": "string", "description": "The shop you pick, e.g. 'Rohlík'."},
            "why": {"type": "string", "description": "A few words, e.g. 'delivers within the hour'."},
        },
        ["choice"],
    ),
]
