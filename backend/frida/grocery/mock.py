"""Demo obchod: košík v paměti a produkty odvozené z katalogu potravin.

Ceny jsou orientační (z katalogu), produkty jsou označené jako demo.
"""

from __future__ import annotations

from datetime import timedelta

from ..db import utcnow
from ..food.catalog import CATALOG, find_spec
from ..schemas import Cart, CartLine, DeliverySlot, GroceryProduct
from ..text import similarity
from .base import GroceryError

_PACKAGES = {"l": "1 l", "kg": "1 kg", "g": "500 g", "ks": "1 ks", "bal": "1 bal", "ml": "500 ml"}


def _products() -> dict[str, GroceryProduct]:
    out: dict[str, GroceryProduct] = {}
    for i, spec in enumerate(CATALOG):
        on_sale = i % 4 == 0
        price = (
            round(spec.typical_price_czk * (0.8 if on_sale else 1.0), 1) if spec.typical_price_czk else 29.9
        )
        out[f"demo-{spec.key}"] = GroceryProduct(
            id=f"demo-{spec.key}",
            name=f"{spec.name} (demo)",
            price_czk=price,
            package=_PACKAGES.get(spec.unit, "1 ks"),
            on_sale=on_sale,
            original_price_czk=spec.typical_price_czk if on_sale else None,
            in_stock=True,
        )
        # druhá varianta (prémiová), ať je z čeho vybírat
        out[f"demo-{spec.key}-bio"] = GroceryProduct(
            id=f"demo-{spec.key}-bio",
            name=f"{spec.name} BIO (demo)",
            price_czk=round(price * 1.6, 1),
            package=_PACKAGES.get(spec.unit, "1 ks"),
            in_stock=i % 7 != 3,
        )
    return out


class DemoGroceryProvider:
    name = "demo"
    mode = "demo"

    def __init__(self) -> None:
        self.products = _products()
        self.lines: dict[str, int] = {}

    async def search(self, query: str, *, limit: int = 6) -> list[GroceryProduct]:
        spec = find_spec(query)
        scored = []
        for p in self.products.values():
            score = similarity(query, p.name)
            if spec and p.id.startswith(f"demo-{spec.key}"):
                score += 1
            if score > 0.35:
                scored.append((score, p))
        return [p for _, p in sorted(scored, key=lambda t: (-t[0], t[1].price_czk))[:limit]]

    async def add_to_cart(self, items: list[tuple[str, int]]) -> Cart:
        for pid, qty in items:
            if pid not in self.products:
                raise GroceryError(f"Produkt {pid} neexistuje")
            self.lines[pid] = self.lines.get(pid, 0) + max(1, int(qty))
        return await self.cart()

    async def remove_from_cart(self, product_id: str) -> Cart:
        self.lines.pop(product_id, None)
        return await self.cart()

    async def cart(self) -> Cart:
        lines = [CartLine(product=self.products[pid], quantity=q) for pid, q in self.lines.items()]
        total = round(sum(line.product.price_czk * line.quantity for line in lines), 1)
        return Cart(
            provider="demo",
            mode="demo",
            lines=lines,
            total_czk=total,
            delivery_note="Demo košík. Po připojení Rohlík MCP se plní skutečný košík.",
            checkout_url="https://www.rohlik.cz/objednavka/prehled-kosiku" if lines else None,
        )

    async def checkout_link(self) -> str | None:
        return "https://www.rohlik.cz/objednavka/prehled-kosiku"

    async def delivery_slots(self) -> list[DeliverySlot]:
        now = utcnow().replace(minute=0, second=0, microsecond=0)
        slots = []
        for i in range(2, 14, 2):
            start = now + timedelta(hours=i)
            slots.append(
                DeliverySlot(
                    id=f"slot-{i}",
                    start=start,
                    end=start + timedelta(hours=1),
                    price_czk=0 if i > 6 else 39,
                    available=i != 4,
                )
            )
        return slots

    async def discounted(self, *, limit: int = 20) -> list[GroceryProduct]:
        return [p for p in self.products.values() if p.on_sale][:limit]
