"""Rozhraní pro online nákup potravin (Rohlík a případně další)."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..schemas import Cart, DeliverySlot, GroceryProduct


class GroceryError(RuntimeError):
    pass


@runtime_checkable
class GroceryProvider(Protocol):
    name: str
    mode: str  # live | demo

    async def search(self, query: str, *, limit: int = 6) -> list[GroceryProduct]: ...

    async def add_to_cart(self, items: list[tuple[str, int]]) -> Cart: ...

    async def remove_from_cart(self, product_id: str) -> Cart: ...

    async def cart(self) -> Cart: ...

    async def checkout_link(self) -> str | None: ...

    async def delivery_slots(self) -> list[DeliverySlot]: ...

    async def discounted(self, *, limit: int = 20) -> list[GroceryProduct]: ...
