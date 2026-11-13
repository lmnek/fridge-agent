"""Klient Rohlík MCP proti falešnému MCP serveru přes stdio (stejná cesta jako `npx @tomaspavlin/rohlik-mcp`)."""

from __future__ import annotations

import shlex
import sys
from pathlib import Path

import pytest

from frida.grocery.base import GroceryError
from frida.grocery.rohlik_mcp import RohlikMcpProvider

FAKE = Path(__file__).parent / "fixtures" / "fake_rohlik_mcp.py"


@pytest.fixture
async def rohlik(settings):
    s = settings.model_copy(
        update={"rohlik_mcp_command": f"{shlex.quote(sys.executable)} {shlex.quote(str(FAKE))}"}
    )
    provider = RohlikMcpProvider(s)
    try:
        yield provider
    finally:
        await provider.close()


async def test_search_add_remove_cart(rohlik):
    tools = {t.name for t in await rohlik.list_tools()}
    assert "search_products" in tools and rohlik.dialect == "community"

    products = await rohlik.search("mléko")
    assert products and products[0].name.startswith("Mléko") and products[0].price_czk == 24.9

    cart = await rohlik.add_to_cart([(products[0].id, 2)])
    assert cart.mode == "live"
    assert cart.lines[0].quantity == 2
    assert cart.total_czk == pytest.approx(49.8)

    cart = await rohlik.remove_from_cart(products[0].id)
    assert cart.lines == []


async def test_blocked_tools_are_never_called(rohlik):
    await rohlik.list_tools()
    with pytest.raises(GroceryError, match="nesmí"):
        await rohlik.call("cancel_order", {"order_id": 1})
