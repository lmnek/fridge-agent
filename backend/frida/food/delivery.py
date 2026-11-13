"""Rozvoz jídla, když se nechce vařit.

Wolt i foodora (dříve Dáme jídlo) mají neoficiální JSON endpointy, ale podmínky
Woltu pro ČR (§13.6) výslovně zakazují automatický sběr dat. Frida je proto
nescrapuje a nabízí jen odkazy do jejich aplikací na hledání dané kuchyně.

Kdyby se podařilo získat partnerský přístup, stačí napsat třídu s metodou `venues()`
podle `DeliveryProvider` a zaregistrovat ji ve `frida/services.py`.
"""

from __future__ import annotations

import hashlib
from typing import Protocol
from urllib.parse import quote

from ..schemas import DeliveryVenue, GeoPoint
from ..text import normalize

# Mapování chuti na kuchyni (pro hledání a demo podniky).
CUISINES: dict[str, tuple[str, ...]] = {
    "pizza": ("pizza", "pizz", "italsk", "testovin", "pasta"),
    "burger": ("burger", "hamburger", "americk"),
    "sushi": ("sushi", "japonsk", "ramen"),
    "asijske": ("asijsk", "cinsk", "cina", "thai", "vietnam", "pho", "bun bo", "wok", "indick", "kari"),
    "mexicke": ("mexick", "burrito", "taco", "quesadill", "nacho"),
    "ceske": ("cesk", "svickov", "gulas", "rizek", "knedl", "polevk"),
    "sladke": ("sladk", "dezert", "zakusek", "dort", "palacink", "zmrzlin", "cokolad"),
    "zdrave": ("zdrav", "salat", "lehk", "bowl", "poke", "vegan", "vegetarian"),
    "kebab": ("kebab", "gyros", "falafel"),
}

CUISINE_LABELS = {
    "pizza": "Pizza",
    "burger": "Burgery",
    "sushi": "Sushi",
    "asijske": "Asijská kuchyně",
    "mexicke": "Mexická kuchyně",
    "ceske": "Česká kuchyně",
    "sladke": "Dezerty",
    "zdrave": "Zdravé jídlo",
    "kebab": "Kebab a gyros",
}

# Odkazy na hledání. Tvar URL se může změnit, proto jsou na jednom místě.
WOLT_SEARCH = "https://wolt.com/cs/cze/prague/search?q={q}"
FOODORA_SEARCH = "https://www.foodora.cz/restaurants/new?lat={lat}&lng={lon}&vertical=restaurants&query={q}"

_DEMO_VENUES: dict[str, tuple[str, ...]] = {
    "pizza": ("Pizzerie Kamenná pec", "Neapol na rohu", "Pizza Vinohrady"),
    "burger": ("Burger Dílna", "Smash & Bun", "Grill Bistro"),
    "sushi": ("Sushi Kawa", "Ramen Kumo"),
    "asijske": ("Pho Hanoi", "Bistro Wok", "Thai Garden"),
    "mexicke": ("Taqueria Azul", "Burrito Loco"),
    "ceske": ("Hospoda U Lípy", "Jídelna Na Rohu"),
    "sladke": ("Cukrárna Pusinka", "Palačinkárna Mlýnek"),
    "zdrave": ("Bowl Street", "Zelená Kuchyně"),
    "kebab": ("Kebab Anatolie", "Gyros Plaka"),
}


def detect_cuisine(text: str) -> str | None:
    norm = normalize(text)
    for cuisine, needles in CUISINES.items():
        if any(n in norm for n in needles):
            return cuisine
    return None


class DeliveryProvider(Protocol):
    name: str

    async def venues(self, craving: str, location: GeoPoint, *, limit: int = 6) -> list[DeliveryVenue]: ...


def search_links(craving: str, location: GeoPoint) -> list[DeliveryVenue]:
    cuisine = detect_cuisine(craving)
    q = CUISINE_LABELS.get(cuisine or "", craving).lower() if cuisine else craving
    return [
        DeliveryVenue(
            id="link-wolt",
            name=f"Hledat „{q}“ ve Woltu",
            cuisine=[cuisine] if cuisine else [],
            url=WOLT_SEARCH.format(q=quote(q)),
            provider="wolt-link",
        ),
        DeliveryVenue(
            id="link-foodora",
            name=f"Hledat „{q}“ ve foodoře",
            cuisine=[cuisine] if cuisine else [],
            url=FOODORA_SEARCH.format(lat=round(location.lat, 5), lon=round(location.lon, 5), q=quote(q)),
            provider="foodora-link",
        ),
    ]


class DemoDeliveryProvider:
    """Smyšlené podniky pro demo. Jsou označené `provider="demo"` a odkazují na skutečné hledání."""

    name = "demo"

    async def venues(self, craving: str, location: GeoPoint, *, limit: int = 6) -> list[DeliveryVenue]:
        cuisine = detect_cuisine(craving) or "ceske"
        names = _DEMO_VENUES.get(cuisine, _DEMO_VENUES["ceske"])
        links = search_links(craving, location)
        out = []
        for i, name in enumerate(names[:limit]):
            h = int(hashlib.sha256(f"{name}{round(location.lat, 2)}".encode()).hexdigest()[:6], 16)
            out.append(
                DeliveryVenue(
                    id=f"demo-{cuisine}-{i}",
                    name=f"{name} (demo)",
                    cuisine=[cuisine],
                    rating=round(8.1 + (h % 17) / 10, 1),
                    delivery_minutes=20 + h % 30,
                    delivery_fee_czk=float((h % 4) * 15 + 19),
                    distance_m=400 + h % 2600,
                    price_level=1 + h % 3,
                    url=links[i % 2].url,
                    provider="demo",
                )
            )
        return out


class LinksOnlyDeliveryProvider:
    """Ostrý režim bez partnerského API: jen odkazy do Woltu a foodory, žádné stahování dat."""

    name = "links"

    async def venues(self, craving: str, location: GeoPoint, *, limit: int = 6) -> list[DeliveryVenue]:
        return []


async def delivery_options(
    provider: DeliveryProvider, craving: str, location: GeoPoint
) -> list[DeliveryVenue]:
    venues = await provider.venues(craving, location)
    return [*venues, *search_links(craving, location)]
