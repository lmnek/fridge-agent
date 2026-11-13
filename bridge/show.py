"""Tools that put the order on the stage panel: show_cart (C4) and show_shops (C3). Part 3, the brain.

The real Rohlík cart lives on OpenAI's side of the MCP call and has no reasons, so the model also calls
show_cart with every item, and that publishes the `cart` event. show_shops publishes `deals`: today's
prices and deals around the flat, which part 8 scrapes into data/deals.json in the same shape.
Event shapes: docs/handoffs/README.md.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

import main as bridge  # main imports this module after emit and STATE exist
from rohlik import read_products

router = APIRouter()


class CartLine(BaseModel):
    name: str
    qty: float = 1
    price_czk: float = 0  # per unit, the total is qty × price
    reason: str = ""
    image_url: str = ""
    product_id: str | int | None = None


class Cart(BaseModel):
    items: list[CartLine]


class Shops(BaseModel):
    choice: str = "Rohlík"
    why: str = ""


def _image(line: CartLine) -> str:
    """The product picks' image URL, so the model never has to spell one out."""
    for row in read_products():
        image = next((v for k, v in row.items() if k.lower().startswith("image")), "")
        if image and (str(line.product_id) == row.get("Product ID") or line.name.lower() == row.get("Item", "").lower()):
            return image.strip("<>")
    return ""


@router.post("/tools/show_cart")
def tool_show_cart(cart: Cart) -> dict[str, Any]:
    items = [line.model_dump(exclude={"product_id"}) | {"image_url": line.image_url or _image(line)} for line in cart.items]
    total = round(sum(i["price_czk"] * i["qty"] for i in items))
    # HACK(demo): without a Rohlík token this is also the fake cart that place_order puts up for approval.
    bridge.STATE["cart"] = items
    bridge.save()
    bridge.emit("cart", items=items, total_czk=total)
    return {"ok": True, "total_czk": total}


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


def deals() -> dict[str, Any]:
    path = bridge.DATA_DIR / "deals.json"
    return json.loads(path.read_text()) if path.exists() else SAMPLE


def deals_markdown() -> str:
    """Today's sales for the household memory, so the model knows them before it plans the order."""
    d = deals()
    sales = [
        f"- {i['item']} at {i['store']}: {i['price_czk']:g} Kč, was {i['was_czk']:g} Kč "
        f"(-{round(100 - 100 * i['price_czk'] / i['was_czk'])} %)."
        for i in d["items"]
        if i.get("was_czk")
    ]
    return "# Today's deals\n\nScraped prices around the flat. On sale today:\n\n" + "\n".join(sales or ["- nothing"])


@router.post("/tools/show_shops")
def tool_show_shops(shops: Shops) -> dict[str, Any]:
    bridge.emit("deals", **deals(), choice=shops.choice, why=shops.why)
    return {"ok": True, "shown": True}


TOOLS = [
    bridge._fn(
        "show_cart",
        "Show the cart on the panel, with every item and its reason. Call it once per order with the whole cart.",
        {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Short English name, e.g. 'Lactose-free milk'."},
                        "product_id": {"type": "string"},
                        "qty": {"type": "number"},
                        "price_czk": {"type": "number", "description": "Price per unit."},
                        "reason": {"type": "string", "description": "One reason tag from the instructions."},
                    },
                    "required": ["name", "qty", "price_czk", "reason"],
                },
            }
        },
        ["items"],
    ),
    bridge._fn(
        "show_shops",
        "Show where to buy on the panel: today's prices and deals across Rohlík and the nearby shops, and your pick.",
        {
            "choice": {"type": "string", "description": "The shop you pick, e.g. 'Rohlík'."},
            "why": {"type": "string", "description": "A few words, e.g. 'delivers within the hour'."},
        },
        ["choice"],
    ),
]
