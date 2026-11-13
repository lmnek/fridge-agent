"""Dohledání výrobku podle čárového kódu (EAN) přes Open Food Facts.

- API: `GET https://world.openfoodfacts.org/api/v2/product/{ean}.json`
- limit 15 čtení za minutu na IP, proto výsledky cachujeme natrvalo,
- User-Agent je obecný název aplikace (`FRIDA_HTTP_USER_AGENT`), nikdy osobní údaje,
- data jsou pod licencí ODbL.

Bez `FRIDA_BARCODE_LIVE=true` se dotaz neposílá a výrobek se dohledá jen
v katalogu podle názvu, který zadáš ručně.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

from ..config import Settings
from ..db import DocStore
from .catalog import find_spec

log = logging.getLogger(__name__)

BARCODES = "barcodes"
OFF_URL = "https://world.openfoodfacts.org/api/v2/product/{ean}.json"
FIELDS = "code,product_name,product_name_cs,brands,quantity,categories_tags,image_front_small_url"


class BarcodeService:
    def __init__(self, settings: Settings, store: DocStore) -> None:
        self.settings = settings
        self.store = store
        self._lock = asyncio.Lock()
        self._calls: list[float] = []

    async def lookup(self, ean: str) -> dict | None:
        ean = "".join(ch for ch in ean if ch.isdigit())
        if not 8 <= len(ean) <= 14:
            return None
        cached = self.store.get_raw(BARCODES, ean)
        if cached is not None:
            return cached or None
        if not self.settings.barcode_live:
            return None
        async with self._lock:
            now = time.monotonic()
            self._calls = [t for t in self._calls if now - t < 60]
            if len(self._calls) >= 12:  # rezerva pod limitem 15/min
                return None
            self._calls.append(now)
            try:
                async with httpx.AsyncClient(
                    timeout=10, headers={"User-Agent": self.settings.http_user_agent}
                ) as http:
                    r = await http.get(OFF_URL.format(ean=ean), params={"fields": FIELDS})
            except httpx.HTTPError as exc:
                log.warning("open food facts: %s", exc)
                return None
        if r.status_code == 404:
            self.store.put(BARCODES, ean, {})
            return None
        if r.status_code != 200:
            return None
        product = (r.json() or {}).get("product") or {}
        name = product.get("product_name_cs") or product.get("product_name")
        if not name:
            self.store.put(BARCODES, ean, {})
            return None
        spec = find_spec(name)
        result = {
            "barcode": ean,
            "name": name,
            "brand": product.get("brands"),
            "quantity": product.get("quantity"),
            "canonical": spec.key if spec else None,
            "category": spec.category if spec else "other",
            "image_url": product.get("image_front_small_url"),
            "source": "openfoodfacts",
        }
        self.store.put(BARCODES, ean, result)
        return result
