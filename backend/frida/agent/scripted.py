"""Frida bez klíče Anthropic: jednoduchá pravidla nad stejnými nástroji.

Není to náhrada za Claude, jen aby šlo celé UI (chat, hlas, hovor, košík,
akce, recepty) vyzkoušet hned po spuštění. Odpovědi se skládají z výsledků
skutečných nástrojů, takže i tady UI vidí běžící nástroje a data.
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from ..food.catalog import find_spec
from ..food.delivery import detect_cuisine
from ..schemas import ToolCallInfo
from ..text import czk, km, normalize
from .tools import ToolContext, run_tool

Emit = Callable[[str], Awaitable[None]]

INTENT_WORDS = {
    "akce",
    "akci",
    "levne",
    "levneji",
    "nejlevneji",
    "sleva",
    "slevy",
    "kde",
    "koupit",
    "koupim",
    "kolik",
    "stoji",
    "najdi",
    "hledej",
    "mi",
    "na",
    "je",
    "v",
    "ve",
    "nejaka",
    "nejake",
    "prosim",
    "chci",
    "mam",
    "chut",
}


def _has(text: str, *needles: str) -> bool:
    return any(n in text for n in needles)


def _product_in(text: str) -> str | None:
    words = [w for w in normalize(text).split() if w not in INTENT_WORDS]
    for n in (3, 2, 1):
        for i in range(len(words) - n + 1):
            gram = " ".join(words[i : i + n])
            if len(gram) < 3:
                continue
            spec = find_spec(gram, threshold=0.7)
            if spec:
                return spec.name
    return None


async def _say(emit: Emit, text: str) -> str:
    """Pošle text po slovech, ať UI vypadá živě i bez modelu."""
    for chunk in re.findall(r"\S+\s*", text):
        await emit(chunk)
        await asyncio.sleep(0.012)
    return text


async def _tool(ctx: ToolContext, name: str, args: dict[str, Any], on_tool) -> dict[str, Any] | None:
    block = await run_tool(ctx, name, args, f"toolu_demo_{uuid.uuid4().hex[:8]}", on_tool)
    if block.get("is_error"):
        return None
    try:
        return json.loads(block["content"])
    except (json.JSONDecodeError, TypeError):
        return None


def _list(names: list[str], *, lower: bool = True) -> str:
    names = [n[:1].lower() + n[1:] if lower and n[1:2].islower() else n for n in names]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " a " + names[-1]


async def scripted_reply(
    ctx: ToolContext, text: str, emit: Emit, on_tool: Callable[[ToolCallInfo], None]
) -> str:
    t = normalize(text)
    voice = ctx.channel == "voice"
    out: list[str] = []

    if voice and _has(
        t, "nashle", "na shledanou", "to je vse", "konec", "zaves", "dekuju to staci", "ahoj diky"
    ):
        await _tool(ctx, "zavesit", {"reason": "rozloučení"}, on_tool)
        return await _say(emit, "Díky, měj se hezky. Ahoj!")

    if _has(t, "zavolej", "zavolat", "zvoni"):
        res = await _tool(ctx, "call_user", {"reason": "Zkušební hovor z chatu."}, on_tool)
        status = (res or {}).get("status")
        msg = {
            "simulated": "Volám ti. V demo režimu hovor přijmeš přímo tady v aplikaci.",
            "sent": "Volám ti na mobil.",
        }.get(status or "", f"Hovor neproběhl. {(res or {}).get('reason') or ''}".strip())
        return await _say(emit, msg)

    if _has(t, "kamer", "podivej", "co vidis", "vyfot"):
        res = await _tool(ctx, "look_in_fridge", {}, on_tool) or {}
        seen = [i["label"] for c in res.get("cameras", []) for i in c.get("items", [])]
        msg = (
            f"Kamerou vidím {len(seen)} věcí, třeba {_list(seen[:5])}."
            if seen
            else "Na snímku teď nic nerozeznám."
        )
        return await _say(emit, msg)

    if _has(t, "rohlik", "kosik", "objednej", "dovez", "doruc"):
        product = _product_in(text)
        if product:
            wanted = [product]
        else:
            needs = await _tool(ctx, "get_shopping_needs", {"horizon_days": 3}, on_tool) or {}
            wanted = [n["name"] for n in needs.get("needs", [])][:6]
        if not wanted:
            return await _say(emit, "Teď nic nedochází, košík nechávám prázdný.")
        found = await asyncio.gather(
            *(_tool(ctx, "rohlik_search", {"query": w, "limit": 1}, on_tool) for w in wanted)
        )
        items = [
            {"product_id": r["products"][0]["id"], "quantity": 1} for r in found if r and r.get("products")
        ]
        if not items:
            return await _say(emit, "V Rohlíku jsem nic vhodného nenašla.")
        cart = await _tool(ctx, "rohlik_add_to_cart", {"items": items}, on_tool) or {}
        names = [line["name"] for line in cart.get("lines", [])]
        msg = (
            f"Do košíku v Rohlíku jsem dala {_list(names[:6])}. Celkem {czk(cart.get('total_czk', 0))}. "
            "Objednávku a čas doručení potvrdíš v Rohlíku"
            + ("." if voice or not cart.get("checkout_url") else f": {cart.get('checkout_url')}")
        )
        if cart.get("mode") == "demo":
            msg += " (Teď běží demo košík, Rohlík zatím není připojený.)"
        return await _say(emit, msg)

    craving = _has(
        t, "chut", "hlad", "uvar", "recept", "vecer", "obed", "snidan", "jidlo", "k jidlu", "navaris"
    )
    cuisine = detect_cuisine(text)
    if craving or cuisine:
        rec = await _tool(ctx, "suggest_recipes", {"craving": text if cuisine else None}, on_tool) or {}
        recipes = rec.get("recipes", [])
        now = [r for r in recipes if not r["missing"]]
        later = [r for r in recipes if r["missing"]]
        if now:
            r = now[0]
            out.append(
                f"Z lednice zvládneš {r['title'].lower()} za {r['minutes']} minut, použiješ {_list(r['uses'][:4])}."
            )
        if later:
            r = later[0]
            out.append(f"Nebo {r['title'].lower()}, stačí dokoupit {_list(r['missing'])}.")
        if cuisine:
            food = await _tool(ctx, "order_food_nearby", {"craving": text}, on_tool) or {}
            venues = [v for v in food.get("venues", []) if v.get("provider") == "demo"]
            if venues:
                v = venues[0]
                out.append(
                    f"Když se ti nechce vařit, {v['name']} doveze za zhruba {v.get('delivery_minutes', 30)} minut. "
                    "Odkazy do Woltu a foodory máš v aplikaci."
                )
        if not out:
            out.append("Z toho, co je doma, teď nic rozumného nevymyslím. Mám najít akce nebo rozvoz?")
        return await _say(emit, " ".join(out))

    if _has(t, "akce", "akci", "levn", "slev", "kde koupit", "kolik stoji", "cena"):
        product = _product_in(text)
        if product:
            res = await _tool(ctx, "find_deals", {"query": product, "max_results": 3}, on_tool) or {}
            deals = res.get("deals", [])
            if not deals:
                return await _say(emit, f"Na {product.lower()} teď v okolí akci nevidím.")
            d = deals[0]
            msg = f"Nejlevněji {product.lower()} v {d['chain']} za {czk(d['price_czk'])}"
            if d.get("discount_pct"):
                msg += f" (sleva {d['discount_pct']} %)"
            if d.get("store"):
                msg += f", nejbližší pobočka {d['store']} ({km(d.get('distance_m'))})"
            msg += "."
            if d.get("requires_card"):
                msg += " Cena platí s věrnostní kartou."
            if res.get("price_verdict"):
                msg += " " + res["price_verdict"]
            if d.get("source") == "demo":
                msg += " (Ceny jsou ukázkové, scrapování akcí je vypnuté.)"
            return await _say(emit, msg)

    if _has(t, "nakup", "nakoupit", "dochazi", "chybi", "dokoupit", "seznam", "akce", "akci", "plan"):
        needs = await _tool(ctx, "get_shopping_needs", {"horizon_days": 3}, on_tool) or {}
        names = [n["name"] for n in needs.get("needs", [])]
        if not names:
            return await _say(emit, "Nic důležitého nedochází. Lednice je v pohodě.")
        plan = await _tool(ctx, "plan_shopping", {"items": names[:10]}, on_tool) or {}
        plans = plan.get("plans", [])
        msg = f"Dochází {_list(names[:6])}."
        if plans:
            p = plans[0]
            msg += f" {p['title']}, celkem {czk(p['total_czk'])}"
            if p.get("savings_czk"):
                msg += f", ušetříš {czk(p['savings_czk'])}"
            msg += ". Mám to rovnou dát do košíku v Rohlíku?"
        return await _say(emit, msg)

    if _has(t, "obchod", "kde jsem", "poloha", "okoli"):
        res = await _tool(ctx, "nearby_stores", {}, on_tool) or {}
        stores = res.get("stores", [])
        if not stores:
            return await _say(emit, "V okolí jsem žádný obchod nenašla.")
        listed = [f"{s['name']} ({s['distance_m']} m)" for s in stores[:4]]
        return await _say(emit, f"Nejblíž máš {_list(listed)}.")

    if _has(t, "lednic", "co mam", "co je", "inventar", "expir", "trvanliv", "kazi", "spotrebov", "prosl"):
        expiring_only = _has(t, "expir", "trvanliv", "kazi", "spotrebov", "prosl")
        res = (
            await _tool(ctx, "get_inventory", {"filter": "expiring" if expiring_only else "all"}, on_tool)
            or {}
        )
        items = res.get("items", [])
        summary = res.get("summary", {})
        soon = [i for i in items if i["status"] in ("expiring", "expired")]
        expired = [i["name"] for i in soon if i["status"] == "expired"]
        expiring = [i["name"] for i in soon if i["status"] == "expiring"]
        if expiring_only:
            if not soon:
                return await _say(emit, "Nic se teď nekazí, všechno má trvanlivost v pořádku.")
            parts = []
            if expiring:
                parts.append(f"Brzy je potřeba sníst: {_list(expiring[:6])}.")
            if expired:
                parts.append(
                    f"Už prošlé: {_list(expired[:4])}. To radši zkontroluj, maso a ryby po datu nejez."
                )
            return await _say(emit, " ".join(parts))
        low = [i["name"] for i in items if i["status"] in ("low", "out")]
        msg = f"V lednici je {summary.get('total_items', len(items))} věcí, čerstvost {summary.get('freshness_score', 0)} ze 100."
        if soon:
            msg += f" Spotřebovat brzy: {_list(expiring[:4])}." if expiring else ""
            msg += f" Prošlé: {_list(expired[:3])}." if expired else ""
        if low:
            msg += f" Dochází {_list(low[:4])}."
        return await _say(emit, msg)

    return await _say(
        emit,
        "Jsem Frida, tvoje lednice. Umím říct, co máš doma a co se kazí, najít akce v okolí, "
        "naplánovat nákup, naplnit košík v Rohlíku, vymyslet jídlo nebo ti zavolat. "
        "Teď běžím bez Claude, takže rozumím jen jednoduchým větám. Plnou konverzaci zapneš klíčem ANTHROPIC_API_KEY.",
    )
