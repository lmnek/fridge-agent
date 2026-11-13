"""Part 8: today's prices and deals for the demo items, scraped ahead of the demo.

Coldex never waits for a scrape: show_shops (show.py) only reads the saved result, so the C3 card is instant.

    uv run python deals.py scrape     # about a minute, writes data/deals.json and bridge/replay/deals.json
    uv run python deals.py show       # prints what's saved

- Rohlík: today's price of each product pick in memory/products.md, live over MCP (get_product_details).
- The shops: deals from akcniceny.cz, through the old Frida scraper (backend/frida/deals/akcniceny.py, it keeps to
  robots.txt's crawl delay), run with backend/.venv's Python. A deal counts only for a similar pack size, so a tray
  of 30 eggs doesn't beat a box of ten, and loyalty card prices don't count.
- Which shops: the two chains with the most matching deals that have a supermarket within RADIUS_M of COLDEX_HOME
  ("lat,lon", default náměstí Míru in Prague), from OpenStreetMap. The nearest store of each chain sets its distance.

The bridge reruns the scrape every DEALS_REFRESH_MIN minutes (default 30) in the background, into data/deals.json.
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
import time
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
SHOPS = 2  # the card has a column per store, Rohlík plus two keeps the item names on one line
REFRESH_MIN = float(os.getenv("DEALS_REFRESH_MIN", "30"))  # the bridge rescrapes in the background, 0 turns it off
DELIVERY_MIN = 60
UA = "Mozilla/5.0 (compatible; coldex-deals)"  # akcniceny.cz
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
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

JUNK = r"protlak|pyré|kečup|omáčk|chips|lupín|sušen|nápoj|drink|čokolád|bonbon|tyčin|sirup|likér|limonád|mirinda|fanta|ledový|baby"


def unjunk(query: str) -> str:
    """JUNK without the words the food itself has (a soy sauce is an omáčka)."""
    return "|".join(w for w in JUNK.split("|") if not re.search(w, query, re.I)) or r"(?!)"


# "What's on sale?": the best leaflet discount per staple in the shops around the flat, with the product photo.
SALES = [
    ("Butter", "máslo", r"\bmáslo\b", r"arašíd|bylink|česnek|kakao|sušenk|pomazán"),
    ("Milk", "mléko", r"\bmléko\b", r"čokolád|kondenz|kokos|sójov|ovesn|mandl|rýžov|tělov|sušen"),
    ("Chicken breast", "kuřecí prsa", r"kuřecí\s+prs", r"šunk|salám|uzen|nugget"),
    ("Cheese", "eidam", r"eidam", r"chips|tyčin"),
    ("Coffee", "káva", r"\bkáva\b|\bkávy\b", r"cukr|bonbon|likér|čokolád"),
    ("Yogurt", "jogurt", r"jogurt", r"nápoj|drink|čokolád|tyčin|müsli"),
    ("Tomatoes", "rajčata", r"rajčat", r"protlak|pyré|kečup|omáčk|sušen|loupan|krájen|pasír"),
    ("Apples", "jablka", r"jabl", r"džus|šťáv|mošt|sušen|chips|přesnídáv|víno|cider"),
    ("Eggs", "vejce", r"\bvejce\b", r"čokol|kinder|vafl|dino|plněn|vaječn|bonbon|figur|velikonoč"),
    ("Bananas", "banány", r"^banán", r"čokol|sušen|chips|lupín"),
    ("Potatoes", "brambory", r"brambor", r"chips|lupín|hranolk|kaše|knedl|plack|salát|krokety"),
    ("Cucumbers", "okurky", r"okurk", r"steriliz|kyselé|nakládan|čalam"),
    ("Onions", "cibule", r"cibul", r"smažen|sušen|chips"),
    ("Spaghetti", "špagety", r"špaget|spaghet", r"boloň|hotov|omáčk"),
    *(
        (name, query, re.escape(query.split()[0][: max(4, len(query.split()[0]) - 2)]), unjunk(query))
        for name, query in [
            ("Ham", "šunka"), ("Salami", "salám"), ("Sausages", "párky"), ("Bacon", "slanina"),
            ("Minced meat", "mleté maso"), ("Pork", "vepřová krkovice"), ("Salmon", "losos"),
            ("Mozzarella", "mozzarella"), ("Parmesan", "parmazán"), ("Cream", "smetana na vaření"),
            ("Sour cream", "zakysaná smetana"), ("Cottage cheese", "cottage"), ("Bread", "chléb"),
            ("Rolls", "rohlík"), ("Rice", "rýže"), ("Pasta", "těstoviny"), ("Flour", "mouka"),
            ("Sugar", "cukr krystal"), ("Oil", "olej"), ("Olive oil", "olivový olej"),
            ("Soy sauce", "sójová omáčka"), ("Ketchup", "kečup"), ("Mustard", "hořčice"),
            ("Pasta sauce", "omáčka na těstoviny"), ("Tomato passata", "passata"), ("Peppers", "paprika"),
            ("Carrots", "mrkev"), ("Garlic", "česnek"), ("Lemons", "citrony"), ("Oranges", "pomeranče"),
            ("Avocado", "avokádo"), ("Lettuce", "salát ledový"), ("Broccoli", "brokolice"),
            ("Mushrooms", "žampiony"), ("Apple juice", "jablečný džus"), ("Orange juice", "pomerančový džus"),
            ("Beer", "pivo"), ("Wine", "víno"), ("Water", "minerální voda"), ("Chocolate", "čokoláda"),
            ("Chips", "chipsy"), ("Ice cream", "zmrzlina"), ("Tea", "čaj"), ("Toilet paper", "toaletní papír"),
        ]
    ),
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


LIVE: dict[str, float] = {}  # product ID -> today's Rohlík price per pack, for show_cart


async def rohlik_prices() -> list[dict[str, Any]]:
    picks = {row["Item"]: int(row["Product ID"]) for row in read_products() if row.get("Product ID", "").isdigit()}
    async with Rohlik() as r:
        reply = await r.call(
            "get_product_details",
            {"product_ids": list(picks.values()), "include_description": False, "context": "Compare grocery prices."},
        )
    products = reply if isinstance(reply, list) else list(reply.values())  # {"1468577": {...}, ...}
    by_id = {p["productId"]: p for p in products if isinstance(p, dict) and "productId" in p}
    LIVE.clear()
    LIVE.update({str(pid): p["prices"].get("salePrice") or p["prices"]["originalPrice"] for pid, p in by_id.items()})
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
    # The search page carries the offers, offer pages are only a fallback and cost a second each.
    source = AkcnicenyDealSource(Settings(http_user_agent=sys.argv[1]), max_offer_pages=0)
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
        [str(python), "-c", RUNNER, UA, *dict.fromkeys([*(i.query for i in ITEMS), *(q for _, q, _, _ in SALES)])],
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


def cheapest(found: Any, match: str, skip: str, around: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """The cheapest offer (per kg or l when the leaflet says) at a chain near the flat, without a loyalty card."""
    if not isinstance(found, list):
        return None
    today = date.today().isoformat()
    ok = [
        d
        for d in found
        if re.search(match, d["product_name"], re.I)
        and not re.search(skip, d["product_name"], re.I)
        and not d.get("requires_card")
        and key(d["chain"]) in around
        and (d.get("valid_from") or today) <= today <= (d.get("valid_to") or today)
    ]
    best = min(ok, key=lambda d: (d.get("unit_price") or d["price_czk"], not d.get("image_url")), default=None)
    if not best:
        return None
    was = best.get("original_price_czk")
    return {
        "product": best["product_name"],
        "store": best["chain"],
        "distance_m": around[key(best["chain"])]["distance_m"],
        "price_czk": best["price_czk"],
        "was_czk": was if was and was > best["price_czk"] else None,
        "unit_price": best.get("unit_price"),
        "unit": best.get("unit_price_unit"),
        "image_url": best.get("image_url") or "",
        "valid_to": best.get("valid_to"),
    }


def sales(raw: dict[str, Any], around: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """The cheapest leaflet offer per SALES staple near the flat, saved ahead so the question is instant."""
    out = []
    for name, query, match, skip in SALES:
        best = cheapest(raw.get(query), match, skip, around)
        if best:
            out.append({"item": name, **best})
    return out


def search_live(query: str) -> dict[str, Any] | None:
    """One food that isn't saved ahead: akcniceny.cz now, about 2 s."""
    python = BACKEND / ".venv" / "bin" / "python"
    res = subprocess.run([str(python), "-c", RUNNER, UA, query], cwd=BACKEND, capture_output=True, text=True, timeout=20)
    if res.returncode:
        return None
    found = json.loads(res.stdout.strip().splitlines()[-1]).get(query)
    stem = re.escape(query.split()[0][: max(4, len(query.split()[0]) - 2)])
    return cheapest(found, stem, unjunk(query), stores_nearby())


def nearby() -> dict[str, dict[str, Any]]:
    """The nearest supermarket of each chain around COLDEX_HOME, from OpenStreetMap."""
    lat, lon = HOME
    query = (
        f'[out:json][timeout:25];nwr["shop"~"^(supermarket|convenience)$"](around:{RADIUS_M},{lat},{lon});'
        "out center tags;"
    )
    res = None
    for server in OVERPASS:  # the main instance answers 502 often, the mirrors share its data
        try:
            res = httpx.post(server, data={"data": query}, headers={"User-Agent": OSM_UA}, timeout=30)
            if res.status_code == 200:
                break
        except httpx.HTTPError:
            continue
    if res is None or res.status_code != 200:
        raise RuntimeError("Every Overpass server failed.")
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


def stores_nearby() -> dict[str, dict[str, Any]]:
    """The OpenStreetMap stores, cached in data/stores.json: they don't move, and Overpass is often slow or down."""
    cache = ROOT / "replay" / "stores.json"  # committed, so a scrape needs Overpass only for a new COLDEX_HOME
    home = ",".join(str(v) for v in HOME)
    saved = json.loads(cache.read_text()) if cache.exists() else {}
    if saved.get("home") == home:
        return saved["stores"]
    stores = nearby()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"home": home, "stores": stores}, ensure_ascii=False))
    return stores


def pick_shops(deals: list[dict[str, Any]], around: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for d in deals:
        if key(d["store"]) in around:
            counts[d["store"]] = counts.get(d["store"], 0) + 1
    ranked = sorted(counts, key=lambda s: (-counts[s], around[key(s)]["distance_m"]))[:SHOPS]
    return [{"name": s, "distance_m": around[key(s)]["distance_m"]} for s in ranked]


# --------------------------------------------------------------------------- CLI


def _no_exit(fn):  # ponytail: sys.exit in a to_thread task escapes asyncio's except and kills uvicorn, so turn it into an Exception
    try:
        return fn()
    except SystemExit as e:
        raise RuntimeError(e) from None


async def scrape(keep: bool = True) -> dict[str, Any]:
    """Scrapes and saves to data/deals.json, and with keep also to the committed bridge/replay/deals.json."""
    t0 = time.monotonic()
    rohlik, raw, around = await asyncio.gather(  # all three at once, akcniceny.cz sets the pace
        rohlik_prices(), asyncio.to_thread(_no_exit, scrape_akcniceny), asyncio.to_thread(_no_exit, stores_nearby)
    )
    shops = shop_deals(raw)
    print(f"{len(rohlik)} Rohlík prices, {len(shops)} matching deals, {len(around)} chains nearby")
    stores = pick_shops(shops, around)
    names = {s["name"] for s in stores}
    result = {
        "scraped_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "home": ",".join(str(v) for v in HOME),
        "stores": [{"name": "Rohlík", "distance_m": None, "delivery_min": DELIVERY_MIN}, *stores],
        "items": [],
        "rohlik_prices": dict(LIVE),
        "sales": sales(raw, around),
    }
    shown = [d for d in shops if d["store"] in names]
    rows = {d["item"] for d in shown}  # only the rows a shop has a price for, the card stays short
    result["items"] = [d for d in rohlik if d["item"] in rows] + shown
    for path in (DATA, SAVED) if keep else (DATA,):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n")
    print(
        f"Saved {DATA}"
        + (f" and {SAVED.relative_to(ROOT.parent)}" if keep else "")
        + f" in {time.monotonic() - t0:.1f} s"
    )
    return result


async def refresh_forever() -> None:
    """The bridge's background refresh: Coldex reads the newest saved scrape and never waits for one."""
    while REFRESH_MIN > 0:
        try:
            await scrape(keep=False)
        except (Exception, SystemExit) as e:  # keep the last good file
            print(f"[deals] refresh failed, keeping the saved scrape: {e}")
        await asyncio.sleep(REFRESH_MIN * 60)


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
