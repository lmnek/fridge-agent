"""Rohlík přes MCP (Model Context Protocol).

Podporované servery (docs/integrace/rohlik-mcp.md):
- **oficiální** `https://mcp.rohlik.cz/mcp` (Streamable HTTP, OAuth bearer token
  z identity.rohlik.cz, případně starší hlavičky `rhl-email` / `rhl-pass`),
- **komunitní** `npx -y @tomaspavlin/rohlik-mcp` (stdio, jméno a heslo).

Frida si po připojení přečte `tools/list` a podle názvů nástrojů pozná, se
kterým serverem mluví. Volat smí jen nástroje z `ALLOWED_TOOLS`. Objednávku
nikdy nedokončuje: podle podmínek Rohlíku ji musí potvrdit zákazník v e-shopu.

Alternativa bez lokálního klienta, až budeš mít OAuth token a veřejný server
(MCP konektor v Messages API, posílá jen bearer token):

    client.beta.messages.create(
        model="claude-opus-5-5", max_tokens=16000,
        betas=["mcp-client-2025-11-20"],
        mcp_servers=[{"type": "url", "url": "https://mcp.rohlik.cz/mcp",
                      "name": "rohlik", "authorization_token": TOKEN}],
        tools=[{"type": "mcp_toolset", "mcp_server_name": "rohlik",
                "default_config": {"enabled": False},
                "configs": {n: {"enabled": True} for n in ALLOWED_TOOLS}}],
        messages=[...],
    )
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import shlex
from typing import Any

from ..config import Settings
from ..schemas import Cart, CartLine, DeliverySlot, GroceryProduct
from .base import GroceryError

log = logging.getLogger(__name__)

# Co smí Frida (a agent) volat. Rušení objednávek, reklamace, plánované úlohy
# a stahování URL jsou záměrně vynechané.
ALLOWED_TOOLS: frozenset[str] = frozenset(
    {
        # oficiální server
        "batch_search_products", "get_product_details", "get_products_composition_batch",
        "get_cart", "add_items_to_cart", "update_cart_item", "remove_cart_item",
        "get_checkout", "get_checkout_link", "get_timeslots_checkout",
        "get_discounted_items", "get_all_user_favorites", "fetch_orders", "get_typical_order",
        "search_recipes_by_vector_similarity", "get_recipe_detail",
        "get_user_shopping_lists_preview", "get_user_shopping_list_detail",
        # komunitní server
        "search_products", "get_cart_content", "add_to_cart", "remove_from_cart",
        "get_delivery_slots", "get_delivery_info", "get_frequent_items", "get_meal_suggestions",
        "get_order_history", "get_shopping_list",
    }
)
BLOCKED_TOOLS: frozenset[str] = frozenset(
    {"cancel_order", "remove_order_items", "submit_claim", "create_scheduled_task", "get_url_content", "clear_cart"}
)
# Nástroje, které agent dostane navíc "průchodem" (jen čtení a plnění košíku).
PASSTHROUGH_TOOLS: frozenset[str] = frozenset(
    {
        "get_discounted_items", "search_recipes_by_vector_similarity", "get_recipe_detail",
        "get_all_user_favorites", "get_typical_order", "fetch_orders", "get_product_details",
        "get_frequent_items", "get_meal_suggestions", "get_order_history",
    }
)


class _Connection:
    """Drží jedno MCP spojení v samostatném tasku (anyio vyžaduje vstup i výstup ve stejném tasku)."""

    def __init__(self, factory) -> None:
        self._factory = factory
        self._client = None
        self._ready = asyncio.Event()
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._error: BaseException | None = None
        self._lock = asyncio.Lock()

    async def get(self):
        async with self._lock:
            if self._client is not None and self._task and not self._task.done():
                return self._client
            self._ready = asyncio.Event()
            self._stop = asyncio.Event()
            self._error = None
            self._task = asyncio.create_task(self._own(), name="rohlik-mcp")
            await asyncio.wait_for(self._ready.wait(), timeout=60)
            if self._error is not None:
                raise GroceryError(f"Nepodařilo se připojit k Rohlík MCP: {self._error}") from self._error
            return self._client

    async def _own(self) -> None:
        try:
            async with self._factory() as client:
                self._client = client
                self._ready.set()
                await self._stop.wait()
        except BaseException as exc:  # noqa: BLE001
            self._error = exc
            self._ready.set()
        finally:
            self._client = None

    def invalidate(self) -> None:
        self._stop.set()

    async def close(self) -> None:
        self._stop.set()
        if self._task:
            with contextlib.suppress(BaseException):
                await asyncio.wait_for(self._task, timeout=10)


class RohlikMcpProvider:
    name = "rohlik"
    mode = "live"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._conn = _Connection(self._open_client)
        self._tools: dict[str, Any] = {}
        self.dialect: str = "unknown"  # official | community

    # ------------------------------------------------------------- spojení
    def _open_client(self):
        from mcp import Client

        s = self.settings
        if s.rohlik_mcp_command:
            from mcp.client.stdio import StdioServerParameters

            parts = shlex.split(s.rohlik_mcp_command)
            env = dict(os.environ)
            if s.rohlik_email:
                env["ROHLIK_USERNAME"] = s.rohlik_email.get_secret_value()
            if s.rohlik_password:
                env["ROHLIK_PASSWORD"] = s.rohlik_password.get_secret_value()
            return Client(StdioServerParameters(command=parts[0], args=parts[1:], env=env))

        import httpx2
        from mcp.client.streamable_http import streamable_http_client

        headers = {"User-Agent": s.http_user_agent}
        if s.rohlik_bearer_token:
            headers["Authorization"] = f"Bearer {s.rohlik_bearer_token.get_secret_value()}"
        elif s.rohlik_email and s.rohlik_password:
            headers["rhl-email"] = s.rohlik_email.get_secret_value()
            headers["rhl-pass"] = s.rohlik_password.get_secret_value()
        http = httpx2.AsyncClient(headers=headers, timeout=httpx2.Timeout(60.0, read=120.0))
        return Client(streamable_http_client(s.rohlik_mcp_url, http_client=http))

    async def list_tools(self) -> list[Any]:
        client = await self._conn.get()
        result = await client.list_tools()
        self._tools = {t.name: t for t in result.tools}
        names = set(self._tools)
        if "batch_search_products" in names or "add_items_to_cart" in names:
            self.dialect = "official"
        elif "search_products" in names:
            self.dialect = "community"
        return list(result.tools)

    async def call(self, tool: str, args: dict[str, Any] | None = None) -> Any:
        if tool in BLOCKED_TOOLS or tool not in ALLOWED_TOOLS:
            raise GroceryError(f"Nástroj {tool} Frida volat nesmí (allowlist v rohlik_mcp.py)")
        if not self._tools:
            await self.list_tools()
        if tool not in self._tools:
            raise GroceryError(f"Server nástroj {tool} nenabízí (dialekt {self.dialect})")
        client = await self._conn.get()
        try:
            result = await client.call_tool(tool, args or {})
        except Exception as exc:
            self._conn.invalidate()
            raise GroceryError(f"{tool}: {exc}") from exc
        if result.is_error:
            raise GroceryError(f"{tool}: {_content_text(result)[:500]}")
        if result.structured_content:
            return result.structured_content
        text = _content_text(result)
        try:
            return json.loads(text)
        except (json.JSONDecodeError, TypeError):
            return text

    async def close(self) -> None:
        await self._conn.close()

    # ------------------------------------------------------------- vysoká úroveň
    async def search(self, query: str, *, limit: int = 6) -> list[GroceryProduct]:
        await self._ensure_dialect()
        if self.dialect == "official":
            raw = await self.call("batch_search_products", {"queries": [{"keyword": query}]})
        else:
            raw = await self.call("search_products", {"product_name": query, "limit": limit})
        return extract_products(raw)[:limit]

    async def add_to_cart(self, items: list[tuple[str, int]]) -> Cart:
        await self._ensure_dialect()
        if self.dialect == "official":
            await self.call("add_items_to_cart", {"items": [{"productId": _num(p), "quantity": q} for p, q in items]})
        else:
            await self.call("add_to_cart", {"products": [{"product_id": _num(p), "quantity": q} for p, q in items]})
        return await self.cart()

    async def remove_from_cart(self, product_id: str) -> Cart:
        await self._ensure_dialect()
        if self.dialect == "official":
            await self.call("remove_cart_item", {"product_id": _num(product_id)})
        else:
            # Komunitní server maže podle order_field_id, které je v obsahu košíku.
            raw = await self.call("get_cart_content")
            field_id = _find_order_field_id(raw, product_id)
            if field_id is None:
                raise GroceryError(f"Produkt {product_id} v košíku není")
            await self.call("remove_from_cart", {"order_field_id": field_id})
        return await self.cart()

    async def cart(self) -> Cart:
        await self._ensure_dialect()
        raw = await self.call("get_cart" if self.dialect == "official" else "get_cart_content")
        lines = extract_cart_lines(raw)
        total = _find_number(raw, ("totalPrice", "total_price", "total", "price_total")) or sum(
            line.product.price_czk * line.quantity for line in lines
        )
        link = None
        with contextlib.suppress(GroceryError):
            link = await self.checkout_link()
        return Cart(
            provider="rohlik",
            mode="live",
            lines=lines,
            total_czk=round(float(total), 1),
            delivery_note="Objednávku dokončíš v aplikaci nebo na webu Rohlíku.",
            checkout_url=link,
        )

    async def checkout_link(self) -> str | None:
        await self._ensure_dialect()
        if self.dialect != "official":
            return "https://www.rohlik.cz/objednavka/prehled-kosiku"
        raw = await self.call("get_checkout_link")
        return _find_url(raw) or "https://www.rohlik.cz/objednavka/prehled-kosiku"

    async def delivery_slots(self) -> list[DeliverySlot]:
        await self._ensure_dialect()
        if self.dialect == "official":
            raw = await self.call("get_timeslots_checkout", {"timeslots_day": "0"})
        else:
            raw = await self.call("get_delivery_slots")
        return extract_slots(raw)

    async def discounted(self, *, limit: int = 20) -> list[GroceryProduct]:
        raw = await self.call("get_discounted_items", {"limit": limit})
        return extract_products(raw)[:limit]

    async def _ensure_dialect(self) -> None:
        if self.dialect == "unknown":
            await self.list_tools()

    def passthrough_tools(self) -> list[Any]:
        return [t for name, t in self._tools.items() if name in PASSTHROUGH_TOOLS]


# ---------------------------------------------------------------------------
# Normalizace odpovědí. Tvar dat MCP serverů není zdokumentovaný, takže se
# hledají typické klíče kdekoli ve stromu JSONu. Agent navíc vždy dostane i
# surovou odpověď, takže mu nic neuteče.
# ---------------------------------------------------------------------------


def _content_text(result: Any) -> str:
    parts = []
    for block in result.content or []:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts)


def _num(value: str) -> int | str:
    return int(value) if str(value).isdigit() else value


def _walk(obj: Any):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def _price(d: dict) -> float | None:
    for key in ("price", "priceFull", "price_czk", "currentPrice", "salePrice", "full"):
        v = d.get(key)
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, dict):
            for inner in ("amount", "full", "value", "price"):
                if isinstance(v.get(inner), (int, float)):
                    return float(v[inner])
    return None


def _product_from(d: dict) -> GroceryProduct | None:
    pid = d.get("productId") or d.get("product_id") or d.get("id")
    name = d.get("productName") or d.get("name") or d.get("title")
    price = _price(d)
    if pid is None or not isinstance(name, str) or price is None:
        return None
    image = d.get("imgPath") or d.get("image") or d.get("imageUrl") or d.get("image_url")
    if isinstance(image, str) and image.startswith("/"):
        image = "https://cdn.rohlik.cz" + image
    original = None
    for key in ("originalPrice", "original_price", "priceBefore", "regularPrice"):
        if isinstance(d.get(key), (int, float)):
            original = float(d[key])
        elif isinstance(d.get(key), dict):
            original = _price({"price": d[key]})
    package = d.get("textualAmount") or d.get("amount")
    return GroceryProduct(
        id=str(pid),
        name=name,
        price_czk=price,
        package=package if isinstance(package, str) else None,
        unit_price=str(d.get("pricePerUnit")) if d.get("pricePerUnit") is not None else None,
        image_url=image if isinstance(image, str) else None,
        in_stock=bool(d.get("inStock", d.get("in_stock", True))),
        on_sale=bool(original and original > price) or bool(d.get("sale") or d.get("discount")),
        original_price_czk=original,
        url=d.get("url") if isinstance(d.get("url"), str) else None,
    )


def extract_products(raw: Any) -> list[GroceryProduct]:
    seen: set[str] = set()
    out: list[GroceryProduct] = []
    for d in _walk(raw):
        p = _product_from(d)
        if p and p.id not in seen:
            seen.add(p.id)
            out.append(p)
    return out


def extract_cart_lines(raw: Any) -> list[CartLine]:
    lines: list[CartLine] = []
    seen: set[str] = set()
    for d in _walk(raw):
        p = _product_from(d)
        qty = d.get("quantity") or d.get("count") or d.get("amountInCart")
        if p and isinstance(qty, (int, float)) and p.id not in seen:
            seen.add(p.id)
            lines.append(CartLine(product=p, quantity=int(qty)))
    return lines


def extract_slots(raw: Any) -> list[DeliverySlot]:
    from datetime import datetime

    slots: list[DeliverySlot] = []
    for d in _walk(raw):
        start = d.get("since") or d.get("start") or d.get("from")
        end = d.get("till") or d.get("end") or d.get("to")
        sid = d.get("id") or d.get("slotId")
        if isinstance(start, str) and isinstance(end, str) and sid is not None:
            try:
                slots.append(
                    DeliverySlot(
                        id=str(sid),
                        start=datetime.fromisoformat(start.replace("Z", "+00:00")),
                        end=datetime.fromisoformat(end.replace("Z", "+00:00")),
                        price_czk=_price(d) or 0.0,
                        available=bool(d.get("available", d.get("capacity", 1))),
                    )
                )
            except ValueError:
                continue
    return slots


def _find_order_field_id(raw: Any, product_id: str) -> Any:
    for d in _walk(raw):
        pid = d.get("productId") or d.get("product_id") or d.get("id")
        if str(pid) == str(product_id):
            return d.get("orderFieldId") or d.get("order_field_id")
    return None


def _find_number(raw: Any, keys: tuple[str, ...]) -> float | None:
    for d in _walk(raw):
        for k in keys:
            v = d.get(k)
            if isinstance(v, (int, float)):
                return float(v)
            if isinstance(v, dict) and isinstance(v.get("amount"), (int, float)):
                return float(v["amount"])
    return None


def _find_url(raw: Any) -> str | None:
    if isinstance(raw, str) and raw.startswith("http"):
        return raw.strip()
    for d in _walk(raw):
        for v in d.values():
            if isinstance(v, str) and v.startswith("https://") and "rohlik" in v:
                return v
    return None
