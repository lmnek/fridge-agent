"""Poloha a obchody v okolí.

- Obchody: OpenStreetMap přes Overpass API (`shop=supermarket|convenience`
  se značkou řetězce). Výsledek se cachuje na 24 hodin.
- Adresa z GPS: Nominatim (limit 1 požadavek za sekundu, vyžaduje User-Agent).
  Posíláme obecný User-Agent aplikace, nikdy osobní údaje.
- Demo režim: řetězce rozmístěné kolem zadané polohy, jasně označené jako demo.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import time
from datetime import timedelta

import httpx

from ..config import Settings
from ..db import DocStore, utcnow
from ..schemas import GeoPoint, Store

log = logging.getLogger(__name__)

STORES_CACHE = "stores_cache"
KNOWN_CHAINS = {
    "albert": "Albert", "lidl": "Lidl", "billa": "Billa", "kaufland": "Kaufland", "penny": "Penny",
    "penny market": "Penny", "tesco": "Tesco", "globus": "Globus", "coop": "Coop", "žabka": "Žabka",
    "zabka": "Žabka", "norma": "Norma", "flop": "Flop", "hruška": "Hruška",
}


def haversine_m(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> int:
    r = 6371000
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return int(2 * r * math.asin(math.sqrt(h)))


def chain_of(tags: dict) -> str | None:
    for key in ("brand", "name", "operator"):
        value = (tags.get(key) or "").lower()
        for needle, chain in KNOWN_CHAINS.items():
            if needle in value:
                return chain
    return None


class GeoService:
    def __init__(self, settings: Settings, store: DocStore) -> None:
        self.settings = settings
        self.store = store
        self._last_nominatim = 0.0
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------- obchody
    async def stores_near(self, point: GeoPoint, radius_m: int | None = None) -> list[Store]:
        radius = radius_m or self.settings.search_radius_m
        if not self.settings.geo_live:
            stores = self._demo_stores(point)
        else:
            stores = await self._overpass_cached(point, radius)
        for s in stores:
            s.distance_m = haversine_m(point.lat, point.lon, s.lat, s.lon)
        return sorted([s for s in stores if (s.distance_m or 0) <= radius * 1.5], key=lambda s: s.distance_m or 0)

    def nearest_by_chain(self, stores: list[Store]) -> dict[str, Store]:
        out: dict[str, Store] = {}
        for s in sorted(stores, key=lambda s: s.distance_m or 0):
            out.setdefault(s.chain, s)
        return out

    async def _overpass_cached(self, point: GeoPoint, radius: int) -> list[Store]:
        key = f"{round(point.lat, 3)}:{round(point.lon, 3)}:{radius}"
        cached = self.store.get_raw(STORES_CACHE, key)
        if cached and utcnow().timestamp() - cached["at"] < timedelta(hours=24).total_seconds():
            return [Store.model_validate(s) for s in cached["stores"]]
        try:
            stores = await self._overpass(point, radius)
        except Exception as exc:  # noqa: BLE001
            log.warning("overpass: %s", exc)
            if cached:
                return [Store.model_validate(s) for s in cached["stores"]]
            return self._demo_stores(point)
        self.store.put(
            STORES_CACHE, key, {"at": utcnow().timestamp(), "stores": [s.model_dump(mode="json") for s in stores]}
        )
        return stores

    async def _overpass(self, point: GeoPoint, radius: int) -> list[Store]:
        query = f"""
        [out:json][timeout:25];
        (
          nwr["shop"~"^(supermarket|convenience)$"](around:{radius},{point.lat},{point.lon});
        );
        out center tags;
        """
        async with httpx.AsyncClient(timeout=30, headers={"User-Agent": self.settings.http_user_agent}) as http:
            r = await http.post(self.settings.overpass_url, data={"data": query})
            r.raise_for_status()
            data = r.json()
        stores: list[Store] = []
        for el in data.get("elements", []):
            tags = el.get("tags", {})
            chain = chain_of(tags)
            if chain is None:
                continue
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lon = el.get("lon") or (el.get("center") or {}).get("lon")
            if lat is None or lon is None:
                continue
            street = " ".join(filter(None, [tags.get("addr:street"), tags.get("addr:housenumber")]))
            stores.append(
                Store(
                    id=f"osm-{el.get('type')}-{el.get('id')}",
                    chain=chain,
                    name=tags.get("name") or chain,
                    lat=float(lat),
                    lon=float(lon),
                    address=street or None,
                    opening_hours=tags.get("opening_hours"),
                )
            )
        return stores

    def _demo_stores(self, point: GeoPoint) -> list[Store]:
        stores = []
        for chain in self.settings.favorite_chains:
            seed = int(hashlib.sha256(f"{chain}:{round(point.lat, 2)}:{round(point.lon, 2)}".encode()).hexdigest()[:8], 16)
            for n in range(1 + seed % 2):
                angle = ((seed >> (n * 3)) % 360) * math.pi / 180
                dist = 250 + ((seed >> (n * 5)) % 1900)
                dlat = dist * math.cos(angle) / 111_320
                dlon = dist * math.sin(angle) / (111_320 * math.cos(math.radians(point.lat)))
                stores.append(
                    Store(
                        id=f"demo-{chain.lower()}-{n}",
                        chain=chain,
                        name=f"{chain} (demo pobočka {n + 1})",
                        lat=point.lat + dlat,
                        lon=point.lon + dlon,
                        address="Ukázková adresa",
                        opening_hours="Mo-Su 07:00-22:00",
                        open_now=True,
                    )
                )
        return stores

    # ------------------------------------------------------------- adresa
    async def reverse(self, point: GeoPoint) -> str:
        if not self.settings.geo_live:
            return self.settings.home_label
        async with self._lock:
            wait = 1.1 - (time.monotonic() - self._last_nominatim)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_nominatim = time.monotonic()
            try:
                async with httpx.AsyncClient(timeout=15, headers={"User-Agent": self.settings.http_user_agent}) as http:
                    r = await http.get(
                        f"{self.settings.nominatim_url}/reverse",
                        params={"lat": point.lat, "lon": point.lon, "format": "jsonv2", "zoom": 16,
                                "accept-language": "cs"},
                    )
                    r.raise_for_status()
                    addr = r.json().get("address", {})
            except Exception as exc:  # noqa: BLE001
                log.warning("nominatim: %s", exc)
                return self.settings.home_label
        district = addr.get("city_district") or addr.get("suburb") or addr.get("quarter")
        city = addr.get("city") or addr.get("town") or "Praha"
        return " – ".join(filter(None, [city, district])) or json.dumps(addr, ensure_ascii=False)[:60]
