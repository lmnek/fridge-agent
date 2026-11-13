"""Falešný MCP server ve tvaru komunitního Rohlík MCP (pro test klienta, běží přes stdio)."""

from __future__ import annotations

import json

from mcp.server.mcpserver import MCPServer

server = MCPServer("fake-rohlik")
CATALOG = {
    1001: {
        "id": 1001,
        "name": "Mléko polotučné 1,5 % 1 l",
        "price": {"full": 24.9},
        "textualAmount": "1 l",
        "inStock": True,
    },
    1002: {
        "id": 1002,
        "name": "Máslo 82 % 250 g",
        "price": {"full": 54.9},
        "textualAmount": "250 g",
        "inStock": True,
    },
}
CART: dict[int, int] = {}


@server.tool()
def search_products(product_name: str, limit: int = 10) -> str:
    hits = [p for p in CATALOG.values() if product_name.lower()[:4] in p["name"].lower()]
    return json.dumps({"products": hits[:limit]}, ensure_ascii=False)


@server.tool()
def add_to_cart(products: list[dict]) -> str:
    for p in products:
        CART[int(p["product_id"])] = CART.get(int(p["product_id"]), 0) + int(p["quantity"])
    return json.dumps({"ok": True})


@server.tool()
def get_cart_content() -> str:
    items = [
        {
            "productId": pid,
            "productName": CATALOG[pid]["name"],
            "quantity": q,
            "price": CATALOG[pid]["price"]["full"],
            "orderFieldId": 9000 + pid,
        }
        for pid, q in CART.items()
    ]
    total = sum(CATALOG[pid]["price"]["full"] * q for pid, q in CART.items())
    return json.dumps({"items": items, "totalPrice": round(total, 2)}, ensure_ascii=False)


@server.tool()
def remove_from_cart(order_field_id: int) -> str:
    CART.pop(int(order_field_id) - 9000, None)
    return json.dumps({"ok": True})


@server.tool()
def cancel_order(order_id: int) -> str:
    raise RuntimeError("tohle nesmí Frida nikdy zavolat")


if __name__ == "__main__":
    server.run("stdio")
