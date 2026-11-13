"""Rohlík MCP from the terminal: check the token, list the tools, look up the product picks, fill the real cart.

    cd bridge
    uv run python rohlik.py status          # is the token valid, and until when
    uv run python rohlik.py tools           # tools/list, marks what Coldex may use
    uv run python rohlik.py search          # top hits for every row in memory/products.md
    uv run python rohlik.py search "guanciale" "vejce 10"
    uv run python rohlik.py cart            # what is in the real cart now
    uv run python rohlik.py fill            # adds memory/products.md to the real cart, prints the checkout link

It only fills the cart. Rohlík completes an order only after a person confirms it in the e-shop.
A minimal Streamable HTTP client on httpx, so the bridge needs no MCP SDK.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

URL = os.getenv("ROHLIK_MCP_URL", "https://mcp.rohlik.cz/mcp")
PRODUCTS = ROOT / "memory" / "products.md"

# What Coldex may call. Everything here reads or fills the cart, nothing can order, cancel or claim.
# main.py passes this to OpenAI as allowed_tools, so the Realtime session never sees the rest.
SAFE_TOOLS = [
    "batch_search_products",
    "get_product_details",
    "get_cart",
    "add_items_to_cart",
    "update_cart_item",
    "remove_cart_item",
    "get_checkout_link",
    "get_discounted_items",
]


class RohlikError(RuntimeError):
    pass


def token_expiry(token: str) -> float | None:
    """The `exp` claim when the token is a JWT, without verifying it."""
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return float(claims["exp"])
    except (IndexError, KeyError, ValueError, TypeError):
        return None


class Rohlik:
    """`async with Rohlik() as r: await r.call("get_cart")`"""

    def __init__(self, token: str | None = None, url: str = URL) -> None:
        self.token = token if token is not None else os.getenv("ROHLIK_TOKEN", "")
        self.url = url
        self.session_id: str | None = None
        self.protocol = "2025-06-18"
        self._id = 0

    async def __aenter__(self) -> Rohlik:
        if not self.token:
            raise RohlikError("ROHLIK_TOKEN is empty in bridge/.env.")
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(60, read=120))
        init = await self._rpc(
            "initialize",
            {"protocolVersion": self.protocol, "capabilities": {}, "clientInfo": {"name": "coldex", "version": "0.1"}},
        )
        self.protocol = init.get("protocolVersion", self.protocol)
        await self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.http.aclose()

    async def _post(self, body: dict[str, Any]) -> httpx.Response:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": self.protocol,
            "User-Agent": "coldex-bridge",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        res = await self.http.post(self.url, json=body, headers=headers)
        if res.status_code == 401:
            raise RohlikError("Rohlík rejected the token (401). Get a fresh one, see SETUP.md.")
        if res.status_code >= 400:
            raise RohlikError(f"Rohlík MCP {res.status_code}: {res.text[:300]}")
        self.session_id = res.headers.get("mcp-session-id", self.session_id)
        return res

    async def _rpc(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        self._id += 1
        res = await self._post({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params})
        for message in _messages(res):
            if message.get("id") == self._id:
                if "error" in message:
                    raise RohlikError(f"{method}: {message['error']}")
                return message["result"]
        raise RohlikError(f"{method}: no reply in {res.text[:300]}")

    async def tools(self) -> list[dict[str, Any]]:
        return (await self._rpc("tools/list", {}))["tools"]

    async def call(self, tool: str, args: dict[str, Any] | None = None) -> Any:
        result = await self._rpc("tools/call", {"name": tool, "arguments": args or {}})
        text = "".join(c.get("text", "") for c in result.get("content", []) if c.get("type") == "text")
        if result.get("isError"):
            raise RohlikError(f"{tool}: {text[:500]}")
        structured = result.get("structuredContent")
        if structured and set(structured) != {"result"}:
            return structured
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text


def _messages(res: httpx.Response) -> list[dict[str, Any]]:
    """A Streamable HTTP reply is either plain JSON or a short SSE stream."""
    if res.headers.get("content-type", "").startswith("application/json"):
        body = res.json()
        return body if isinstance(body, list) else [body]
    out, data = [], []
    for line in [*res.text.splitlines(), ""]:
        if line.startswith("data:"):
            data.append(line[5:].strip())
        elif not line and data:
            out.append(json.loads("\n".join(data)))
            data = []
    return out


# --------------------------------------------------------------------------- products.md


def read_products() -> list[dict[str, str]]:
    """The rows of the product picks table."""
    rows = [line for line in PRODUCTS.read_text().splitlines() if line.startswith("|")]
    header = [c.strip() for c in rows[0].strip("|").split("|")]
    return [dict(zip(header, (c.strip() for c in row.strip("|").split("|")), strict=False)) for row in rows[2:]]


def _num(text: str | None) -> float:
    try:
        return float((text or "").replace(",", ".").split()[0])
    except (ValueError, IndexError):
        return 0.0


# --------------------------------------------------------------------------- CLI


def _products_of(raw: Any) -> list[dict[str, Any]]:
    """Every dict in a search reply that looks like a product (it has an id and a name)."""
    found: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if any(k in node for k in ("productId", "product_id", "id")) and any(
                k in node for k in ("productName", "name", "title")
            ):
                found.append(node)
                return
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(raw)
    return found


def _line(p: dict[str, Any]) -> str:
    pid = p.get("productId") or p.get("product_id") or p.get("id")
    name = p.get("productName") or p.get("name") or p.get("title")
    price = p.get("price") or p.get("priceCzk") or p.get("price_czk")
    if isinstance(price, dict):
        price = price.get("amount") or price.get("full") or price
    sale = p.get("sales") or p.get("sale") or p.get("discount") or ""
    stock = p.get("inStock", p.get("in_stock", ""))
    return f"{pid}  {name}  {price} Kč  {p.get('textualAmount') or p.get('amount') or ''}  {sale or ''}  {stock}"


async def cmd_status() -> None:
    token = os.getenv("ROHLIK_TOKEN", "")
    exp = token_expiry(token) if token else None
    if exp:
        left = (exp - time.time()) / 60
        print(f"Token expires {time.strftime('%H:%M', time.localtime(exp))}, in {left:.0f} min.")
    async with Rohlik() as r:
        names = [t["name"] for t in await r.tools()]
    print(f"Token works: {len(names)} tools.")


async def cmd_tools() -> None:
    async with Rohlik() as r:
        tools = await r.tools()
    for t in sorted(tools, key=lambda t: t["name"]):
        mark = "SAFE" if t["name"] in SAFE_TOOLS else "    "
        summary = (t.get("description") or "").strip().split("\n")[0][:90]
        print(f"{mark}  {t['name']:<40} {summary}")
    missing = [n for n in SAFE_TOOLS if n not in {t["name"] for t in tools}]
    if missing:
        print(f"\nNot on the server, fix SAFE_TOOLS: {', '.join(missing)}")
    if "-v" in sys.argv:
        for t in tools:
            if t["name"] in SAFE_TOOLS:
                print(f"\n{t['name']}\n{json.dumps(t.get('inputSchema'), ensure_ascii=False)}")


async def cmd_search(keywords: list[str]) -> None:
    keywords = keywords or [row["Rohlík product"] for row in read_products()]
    out = ROOT.parent / "data" / "rohlik-search.json"
    raw_all = {}
    async with Rohlik() as r:
        for start in range(0, len(keywords), 4):  # the server takes at most 4 queries per call
            batch = keywords[start : start + 4]
            raw = await r.call("batch_search_products", {"queries": [{"keyword": k} for k in batch]})
            raw_all[" | ".join(batch)] = raw
            hits = _products_of(raw)
            print(f"\n== {' | '.join(batch)}: {len(hits)} hits")
            for p in hits[:24]:
                print("  " + _line(p))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(raw_all, ensure_ascii=False, indent=2))
    print(f"\nRaw replies (image URLs too): {out}")


async def cmd_cart() -> None:
    async with Rohlik() as r:
        print(json.dumps(await r.call("get_cart"), ensure_ascii=False, indent=2)[:4000])


async def cmd_fill() -> None:
    rows = [row for row in read_products() if row.get("Product ID", "TODO") not in ("", "TODO")]
    if not rows:
        sys.exit("No product IDs in memory/products.md yet. Run `search` first and fill the table.")
    total = sum(_num(r["Price (Kč)"]) * _num(r["Qty"]) for r in rows)
    print(f"products.md: {len(rows)} items, {total:.0f} Kč by the table.")
    async with Rohlik() as r:
        before = await r.call("get_cart")
        if _products_of(before) and "--keep" not in sys.argv:
            sys.exit("The real cart is not empty. Empty it on rohlik.cz, or run `fill --keep` to add on top.")
        items = [{"productId": int(row["Product ID"]), "quantity": int(_num(row["Qty"]))} for row in rows]
        await r.call("add_items_to_cart", {"items": items})
        cart = await r.call("get_cart")
        print(json.dumps(cart, ensure_ascii=False, indent=2)[:3000])
        link = await r.call("get_checkout_link")
    print(f"\nCheckout link: {link}")
    print("Only a person can complete the order on rohlik.cz.")


def _quantities(cart: Any) -> dict[int, int]:
    """Product ID -> quantity in a get_cart reply."""
    out: dict[int, int] = {}
    for p in _products_of(cart):
        pid = p.get("productId") or p.get("product_id") or p.get("id")
        qty = p.get("quantity") or p.get("amount") or p.get("count")
        if pid is not None and qty is not None:
            out[int(pid)] = int(qty)
    return out


async def set_cart(lines: list[tuple[int, int]]) -> dict[str, Any]:
    """Makes the real cart hold exactly these quantities, other products stay. Repeating it doesn't double
    anything, so a second show_cart or the model's own add_items_to_cart is harmless. Never orders."""
    async with Rohlik() as r:
        have = _quantities(await r.call("get_cart"))
        add = [{"productId": pid, "quantity": q} for pid, q in lines if pid not in have]
        if add:
            await r.call("add_items_to_cart", {"items": add})
        for pid, q in lines:
            if pid in have and have[pid] != q:
                await r.call("update_cart_item", {"product_id": pid, "quantity": q})
        cart = await r.call("get_cart")
        link = await r.call("get_checkout_link")
    data = cart.get("data", {}) if isinstance(cart, dict) else {}
    url = link.get("checkout_link") if isinstance(link, dict) else str(link)
    return {"total_czk": data.get("totalPrice"), "checkout_url": url, "products": len(_quantities(cart))}


def main() -> None:
    cmd, *rest = sys.argv[1:] or ["status"]
    rest = [a for a in rest if not a.startswith("-")]
    commands = {
        "status": cmd_status,
        "tools": cmd_tools,
        "search": lambda: cmd_search(rest),
        "cart": cmd_cart,
        "fill": cmd_fill,
    }
    if cmd not in commands:
        sys.exit(__doc__)
    try:
        asyncio.run(commands[cmd]())
    except RohlikError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
