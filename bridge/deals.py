"""Part 8: today's prices and deals for the demo items, scraped ahead of the demo.

Coldex never waits for a scrape: show_shops (show.py) only reads the saved result, so the C3 card is instant.

    uv run python deals.py scrape     # about a minute, writes data/deals.json and bridge/replay/deals.json
    uv run python deals.py show       # prints what's saved

- Rohlík: today's price of each product pick in memory/products.md, live over MCP (get_product_details).
- The shops: deals from akcniceny.cz, through the old Frida scraper (backend/frida/deals/akcniceny.py, it keeps to
  robots.txt's crawl delay), run with backend/.venv's Python. A deal counts only for a similar pack size, so a tray
  of 30 eggs doesn't beat a box of ten, and loyalty card prices don't count.
- Which shops: the chains with the most matching deals that have a supermarket within RADIUS_M of COLDEX_HOME
  ("lat,lon", default náměstí Míru in Prague), from OpenStreetMap. The nearest store of each chain sets its distance.

bridge/replay/deals.json is committed, so a fresh checkout shows the last real scrape instead of the sample.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

from rohlik import Rohlik, read_products  # noqa: E402

DATA = Path(os.getenv("DATA_DIR", ROOT.parent / "data")) / "deals.json"
SAVED = ROOT / "replay" / "deals.json"
BACKEND = ROOT.parent / "backend"
HOME = tuple(float(v) for v in os.getenv("COLDEX_HOME", "50.0755,14.4378").split(","))
RADIUS_M = 1500
SHOPS = 3  # the card has a column per store, Rohlík plus three fits
DELIVERY_MIN = 60
UA = "Mozilla/5.0 (compatible; coldex-deals)"  # akcniceny.cz
OSM_UA = "coldex-deals/0.1"  # Overpass answers 406 to a Mozilla User-Agent


@dataclass
class Item:
    name: str  # the row on the card, the Item column of products.md
    query: str  # akcniceny.cz search
    match: str  # the shop's product name must match this
    pack: tuple[float, str]  # the size we compare, in kg, l or ks
    skip: str = r"(?!)"


ITEMS = [
    Item("Lactose-free milk", "mléko bez laktózy", r"mléko.*bez\s+laktóz|bez\s+laktóz.*mléko", (1, "l")),
    Item("Eggs", "vejce", r"\bvejce\b", (10, "ks"), r"čokol|kinder|vafl|dino|plněn|vaječn|bonbon|figur|velikonoč"),
    Item("Guanciale", "guanciale", r"guanciale", (0.1, "kg")),
    Item("Spaghetti", "špagety", r"špaget|spaghet", (0.5, "kg"), r"boloň|talíř|hipp|bezlep|sýr|omáčk|hotov"),
    Item(
        "Gluten-free spaghetti",
        "bezlepkové špagety",
        r"bezlep.*(špaget|spaghet|těstovin)|(špaget|spaghet|těstovin).*bezlep",
        (0.4, "kg"),
    ),
    Item("Greek yogurt", "řecký jogurt", r"řeck\w*\s+(bílý\s+)?jogurt|jogurt\s+řeck", (0.14, "kg")),
    Item("Bananas", "banány", r"^banány\b", (1, "kg"), r"čokol|sušen|chips|lupín"),
]

_PACK = re.compile(r"(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|ks)\b", re.IGNORECASE)


def pack(text: str | None) -> tuple[float, str] | None:
    """'500 g' -> (0.5, 'kg'), '1 l' -> (1, 'l'), '10 ks' -> (10, 'ks'), '3 x 20 g' -> (0.06, 'kg')."""
    m = _PACK.search((text or "").replace(",", "."))
    if not m:
        return None
    amount = float(m[2]) * (int(m[1]) if m[1] else 1)
    unit = m[3].lower()
    return {"g": (amount / 1000, "kg"), "ml": (amount / 1000, "l")}.get(unit, (amount, unit))


def similar(have: tuple[float, str] | None, want: tuple[float, str]) -> bool:
    return bool(have) and have[1] == want[1] and 0.6 <= have[0] / want[0] <= 1.6


def per(item: Item) -> str:
    """The row label, with the size when the comparison isn't per pack (bananas are sold by the piece at Rohlík)."""
    return f"{item.name}, per kg" if item.pack == (1, "kg") else item.name


def key(chain: str) -> str:
    """'Tesco Expres' and 'TESCO' -> 'tesco', 'Albert Supermarket' -> 'albert'."""
    plain = unicodedata.normalize("NFKD", chain).encode("ascii", "ignore").decode().lower()
    return plain.split()[0] if plain.split() else ""


# --------------------------------------------------------------------------- Rohlík


async def rohlik_prices() -> list[dict[str, Any]]:
    picks = {row["Item"]: int(row["Product ID"]) for row in read_products() if row.get("Product ID", "").isdigit()}
    async with Rohlik() as r:
        reply = await r.call(
            "get_product_details",
            {"product_ids": list(picks.values()), "include_description": False, "context": "Compare grocery prices."},
        )
    products = reply if isinstance(reply, list) else list(reply.values())  # {"1468577": {...}, ...}
    by_id = {p["productId"]: p for p in products if isinstance(p, dict) and "productId" in p}
    out = []
    for item in ITEMS:
        p = by_id.get(picks.get(item.name))
        if not p:
            continue
        prices = p["prices"]
        price, was = prices.get("salePrice") or prices["originalPrice"], None
        if prices.get("salePrice"):
            was = prices["originalPrice"]
        if not similar(pack(p.get("textualAmount")), item.pack):  # sold by the piece: compare Rohlík's price per kg
            price, was = round(prices["unitPrice"] * item.pack[0], 2), None
        out.append({"item": per(item), "store": "Rohlík", "price_czk": price, "was_czk": was, "product": p["name"]})
    return out


# --------------------------------------------------------------------------- the shops

RUNNER = r"""
import asyncio, json, sys
from frida.config import Settings
from frida.deals.akcniceny import AkcnicenyDealSource

async def main():
    source = AkcnicenyDealSource(Settings(http_user_agent=sys.argv[1]))
    out = {}
    for query in sys.argv[2:]:
        try:
            out[query] = [d.model_dump(mode="json") for d in await source.search(query)]
        except Exception as e:
            out[query] = {"error": f"{type(e).__name__}: {e}"}
    print(json.dumps(out, ensure_ascii=False))

asyncio.run(main())
"""


def scrape_akcniceny() -> dict[str, Any]:
    python = BACKEND / ".venv" / "bin" / "python"
    if not python.exists():
        sys.exit(f"No {python}. The shop scrape runs the old Frida scraper with the backend's Python.")
    res = subprocess.run(
        [str(python), "-c", RUNNER, UA, *(i.query for i in ITEMS)],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if res.returncode:
        sys.exit(f"akcniceny.cz scrape failed:\n{res.stderr[-2000:]}")
    return json.loads(res.stdout.strip().splitlines()[-1])


def shop_deals(raw: dict[str, Any]) -> list[dict[str, Any]]:
    today = date.today().isoformat()
    out = []
    for item in ITEMS:
        found = raw.get(item.query)
        if not isinstance(found, list):
            print(f"  {item.name}: {found.get('error') if found else 'no reply'}")
            continue
        best: dict[str, dict[str, Any]] = {}
        for d in found:
            name = d["product_name"]
            if not re.search(item.match, name, re.I) or re.search(item.skip, name, re.I) or d.get("requires_card"):
                continue
            if not similar(pack(d.get("package")) or pack(name), item.pack):
                continue
            if (d.get("valid_from") or today) > today or (d.get("valid_to") or today) < today:
                continue
            chain = d["chain"]
            if chain not in best or d["price_czk"] < best[chain]["price_czk"]:
                best[chain] = d
        for chain, d in best.items():
            out.append(
                {
                    "item": per(item),
                    "store": chain,
                    "price_czk": d["price_czk"],
                    "was_czk": d.get("original_price_czk"),
                    "product": d["product_name"],
                    "valid_to": d.get("valid_to"),
                }
            )
    return out


def nearby() -> dict[str, dict[str, Any]]:
    """The nearest supermarket of each chain around COLDEX_HOME, from OpenStreetMap."""
    lat, lon = HOME
    query = (
        f'[out:json][timeout:25];nwr["shop"~"^(supermarket|convenience)$"](around:{RADIUS_M},{lat},{lon});'
        "out center tags;"
    )
    res = httpx.post(
        "https://overpass-api.de/api/interpreter", data={"data": query}, headers={"User-Agent": OSM_UA}, timeout=40
    )
    res.raise_for_status()
    stores: dict[str, dict[str, Any]] = {}
    for el in res.json()["elements"]:
        tags = el.get("tags", {})
        name = tags.get("brand") or tags.get("name") or ""
        at = el.get("center") or el
        if not name or "lat" not in at:
            continue
        dy = (at["lat"] - lat) * 111_320
        dx = (at["lon"] - lon) * 111_320 * math.cos(math.radians(lat))
        meters = round(math.hypot(dx, dy) / 10) * 10
        k = key(name)
        if k not in stores or meters < stores[k]["distance_m"]:
            stores[k] = {"distance_m": meters, "address": tags.get("addr:street", "")}
    return stores


def pick_shops(deals: list[dict[str, Any]], around: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for d in deals:
        if key(d["store"]) in around:
            counts[d["store"]] = counts.get(d["store"], 0) + 1
    ranked = sorted(counts, key=lambda s: (-counts[s], around[key(s)]["distance_m"]))[:SHOPS]
    return [{"name": s, "distance_m": around[key(s)]["distance_m"]} for s in ranked]


# --------------------------------------------------------------------------- CLI


async def scrape() -> dict[str, Any]:
    print("Rohlík, live over MCP ...")
    rohlik = await rohlik_prices()
    print(f"  {len(rohlik)} prices")
    print("akcniceny.cz, about a second per request ...")
    shops = shop_deals(await asyncio.to_thread(scrape_akcniceny))
    print(f"  {len(shops)} matching deals")
    print("Nearby shops, OpenStreetMap ...")
    stores = pick_shops(shops, await asyncio.to_thread(nearby))
    names = {s["name"] for s in stores}
    result = {
        "scraped_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "home": ",".join(str(v) for v in HOME),
        "stores": [{"name": "Rohlík", "distance_m": None, "delivery_min": DELIVERY_MIN}, *stores],
        "items": rohlik + [d for d in shops if d["store"] in names],
    }
    for path in (DATA, SAVED):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n")
    print(f"Saved {DATA} and {SAVED.relative_to(ROOT.parent)}")
    return result


def show(result: dict[str, Any]) -> None:
    stores = [s["name"] for s in result["stores"]]
    print(
        f"Scraped {result['scraped_at']}, shops: "
        + ", ".join(
            f"{s['name']} ({s['distance_m']} m)" if s["distance_m"] is not None else s["name"] for s in result["stores"]
        )
    )
    rows = list(dict.fromkeys(d["item"] for d in result["items"]))
    print(f"{'':26}" + "".join(f"{s:>14}" for s in stores))
    for row in rows:
        cells = []
        for s in stores:
            d = next((d for d in result["items"] if d["item"] == row and d["store"] == s), None)
            cells.append(f"{d['price_czk']:g}{'*' if d.get('was_czk') else ''}" if d else "-")
        print(f"{row:26}" + "".join(f"{c:>14}" for c in cells))
    print("* on sale")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["scrape", "show"])
    args = parser.parse_args()
    if args.command == "scrape":
        show(asyncio.run(scrape()))
    else:
        path = DATA if DATA.exists() else SAVED
        show(json.loads(path.read_text()))


if __name__ == "__main__":
    main()
