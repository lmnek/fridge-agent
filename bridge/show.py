"""Tools that put the order on the stage panel: show_cart (C4) and show_shops (C3). Part 3, the brain.

The real Rohlík cart lives on OpenAI's side of the MCP call and has no reasons, so the model also calls
show_cart with every item, and that publishes the `cart` event. show_shops publishes `deals`: today's
prices and deals around the flat, which part 8 scrapes into data/deals.json in the same shape.
Event shapes: docs/handoffs/README.md.
"""

from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

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
    shops = ", ".join(f"{s['name']} {s['distance_m']} m" for s in d["stores"] if s.get("distance_m") is not None)
    return (
        "# Today's deals\n\nScraped prices around the flat. On sale today:\n\n"
        + "\n".join(sales or ["- nothing"])
        + (f"\n\nNearest shops: {shops}. Rohlík delivers within the hour." if shops else "")
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


@router.post("/tools/show_product")
async def tool_show_product(ask: ProductAsk) -> dict[str, Any]:
    """A small product card on the kitchen screen for a price question: the photo, today's Rohlík price and the
    cheapest shop deal. A product pick is instant (saved scrape). Anything else is searched on Rohlík live."""
    pick = _pick(ask.item) if ask.item.strip() else {}
    d = deals()
    if pick:
        card = {
            "item": pick["Item"],
            "product": _col(pick, "rohlík product"),
            "image_url": _col(pick, "image").strip("<>"),
            "price_czk": _live(pick) or _num(_col(pick, "price")),
        }
    else:
        try:
            async with Rohlik() as r:
                raw = await r.call("batch_search_products", {"queries": [{"keyword": ask.item}]})
            hit = next((h for h in _products_of(raw) if h.get("price")), None)
        except Exception as e:  # no token or Rohlík down: say so instead of hanging
            return {"ok": False, "error": f"Rohlík search failed: {e}"[:300]}
        if not hit:
            return {"ok": False, "error": f"Nothing on Rohlík for {ask.item}."}
        pid = hit.get("productId")
        card = {
            "item": ask.item,
            "product": f"{hit.get('productName', '')}, {hit.get('textualAmount', '')}".strip(", "),
            "image_url": "",
            "price_czk": hit.get("price"),
        }
        bridge.emit("product", **card, deal=None)
        _image_later(pid, card)
        return {"ok": True, **{k: card[k] for k in ("item", "product", "price_czk")}}
    name = card["item"].lower()
    shop = [i for i in d["items"] if i["store"] != "Rohlík" and i["item"].lower().startswith(name)]
    deal = min(shop, key=lambda i: i["price_czk"], default=None)
    card["deal"] = (
        {
            "store": deal["store"],
            "price_czk": deal["price_czk"],
            "was_czk": deal.get("was_czk"),
            "per": "kg" if "per kg" in deal["item"] else None,
        }
        if deal
        else None
    )
    bridge.emit("product", **card)
    return {"ok": True, "item": card["item"], "price_czk": card["price_czk"], "deal": card["deal"]}


def _image_later(pid: Any, card: dict[str, Any]) -> None:
    """Search replies carry no picture, so fetch it from the product page and update the card when it lands."""
    import threading

    def run() -> None:
        try:
            import re

            import httpx

            html = httpx.get(
                f"https://www.rohlik.cz/{pid}", headers={"User-Agent": "Mozilla/5.0"}, timeout=6, follow_redirects=True
            ).text
            m = re.search(rf"https://cdn\.rohlik\.cz/images/grocery/products/{pid}/[^\"'\s?]+\.(?:jpg|png|webp)", html)
            if m:
                bridge.emit("product", **{**card, "image_url": m.group(0)}, deal=None)
        except Exception:
            pass

    threading.Thread(target=run, daemon=True).start()


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
        "show_product",
        "Show one food's photo and price on the kitchen screen, with the cheapest nearby deal. Call it for a "
        "question about one food's price, in the same response as your spoken answer.",
        {"item": {"type": "string", "description": "The food in English, e.g. 'Eggs' or 'Butter'."}},
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
