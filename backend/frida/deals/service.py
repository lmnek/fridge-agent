"""Hledání akcí v okolí: zdroje -> párování -> nejbližší pobočka -> řazení.

Navíc si Frida pamatuje historii cen (co kdy kde stálo), takže umí říct
"kup teď, levněji to za poslední 3 měsíce nebylo" nebo "počkej, bývá to levněji".
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta

from ..config import Settings
from ..db import DocStore, utcnow
from ..food.catalog import canonical_for, find_spec
from ..geo.service import GeoService
from ..schemas import Deal, DealSearchResult, GeoPoint, PriceHistoryPoint, PriceInsight, ShoppingPlan, Store
from ..text import czk, normalize, similarity
from .base import DealSource, DealSourceError
from .optimizer import PlannerConfig, plan_shopping

log = logging.getLogger(__name__)

DEALS_CACHE = "deals_cache"
PRICE_HISTORY = "price_history"
MIN_MATCH = 0.42

# Co se tváří jako hledaná potravina, ale není to ona (normalizované kořeny slov).
EXCLUDE: dict[str, tuple[str, ...]] = {
    "maslo": (
        "margarin",
        "rostlinn",
        "roztirat",
        "telov",
        "vanock",
        "olej",
        "pomazank",
        "rama",
        "flora",
        "perla",
        "susenk",
        "bylinkov",
    ),
    "mleko": ("cokolad", "kokosov", "mandlov", "ovesn", "sojov", "kondenz", "mlecna rez", "telov"),
    "jogurt-bily": ("napoj", "pitny", "ovocn", "cokolad"),
    "vejce": ("cokolad", "kinder", "nudle", "testovin"),
    "kureci-prsa": ("krmiv", "kapsick", "pes", "kocka", "kocic", "psi"),
    "syr-eidam": ("tavene", "tycink"),
}


def excluded(canonical: str, product_name: str) -> bool:
    norm = normalize(product_name)
    return any(word in norm for word in EXCLUDE.get(canonical, ()))


class DealService:
    def __init__(
        self, settings: Settings, store: DocStore, geo: GeoService, sources: list[DealSource]
    ) -> None:
        self.settings = settings
        self.store = store
        self.geo = geo
        self.sources = sources

    # ------------------------------------------------------------- hledání
    async def _from_source(self, source: DealSource, query: str) -> list[Deal]:
        key = f"{source.name}:{canonical_for(query)}:{query.lower()}"
        cached = self.store.get_raw(DEALS_CACHE, key)
        ttl = timedelta(minutes=self.settings.deals_cache_minutes).total_seconds()
        if cached and utcnow().timestamp() - cached["at"] < ttl:
            return [Deal.model_validate(d) for d in cached["deals"]]
        deals = await source.search(query)
        self.store.put(
            DEALS_CACHE,
            key,
            {"at": utcnow().timestamp(), "deals": [d.model_dump(mode="json") for d in deals]},
        )
        self._record_history(deals)
        return deals

    async def search(self, query: str, *, location: GeoPoint, today: date | None = None) -> DealSearchResult:
        today = today or date.today()
        results = await asyncio.gather(
            *(self._from_source(s, query) for s in self.sources), return_exceptions=True
        )
        deals: list[Deal] = []
        used: list[str] = []
        notes: list[str] = []
        for source, res in zip(self.sources, results, strict=True):
            if isinstance(res, DealSourceError):
                notes.append(f"{source.name}: nedostupné")
                continue
            if isinstance(res, BaseException):
                log.warning("deal source %s failed: %s", source.name, res)
                notes.append(f"{source.name}: chyba")
                continue
            used.append(source.name)
            deals.extend(res)

        stores = await self.geo.stores_near(location)
        nearest = self.geo.nearest_by_chain(stores)
        canonical = canonical_for(query)
        spec = find_spec(query)
        filtered: list[Deal] = []
        for d in deals:
            if d.valid_to and d.valid_to < today:
                continue
            if excluded(canonical, d.product_name):
                continue
            score = max(similarity(query, d.product_name), 1.0 if d.canonical == canonical and spec else 0.0)
            if score < MIN_MATCH:
                continue
            filtered.append(
                d.model_copy(update={"match_score": round(score, 3), "nearest_store": nearest.get(d.chain)})
            )

        favorites = set(self.settings.favorite_chains)

        def rank(d: Deal) -> tuple:
            future = d.valid_from is not None and d.valid_from > today
            far = d.nearest_store is None
            per_unit = d.unit_price if d.unit_price is not None else d.price_czk
            return (future, far, d.chain not in favorites, -round(d.match_score, 1), per_unit)

        filtered.sort(key=rank)
        best = next((d for d in filtered if not (d.valid_from and d.valid_from > today)), None)
        return DealSearchResult(
            query=query,
            canonical=canonical,
            deals=filtered[:30],
            best=best,
            fetched_at=utcnow(),
            sources=used,
            note="; ".join(notes) if notes else None,
        )

    async def search_many(self, queries: list[str], *, location: GeoPoint) -> dict[str, DealSearchResult]:
        results = await asyncio.gather(*(self.search(q, location=location) for q in queries))
        return dict(zip(queries, results, strict=True))

    # ------------------------------------------------------------- plán
    async def plan(
        self,
        queries: list[str],
        *,
        location: GeoPoint,
        online_prices: dict[str, float] | None = None,
        cfg: PlannerConfig | None = None,
    ) -> list[ShoppingPlan]:
        found = await self.search_many(queries, location=location)
        stores = await self.geo.stores_near(location)
        nearest: dict[str, Store] = self.geo.nearest_by_chain(stores)
        return plan_shopping(
            {q: r.deals for q, r in found.items()},
            home=location,
            stores_by_chain=nearest,
            online_prices=online_prices,
            favorite_chains=self.settings.favorite_chains,
            cfg=cfg,
        )

    # ------------------------------------------------------------- historie cen
    def _record_history(self, deals: list[Deal]) -> None:
        day = date.today().isoformat()
        for d in deals:
            key = f"{d.canonical}:{d.chain}:{day}"
            existing = self.store.get_raw(PRICE_HISTORY, key)
            if existing and existing["price_czk"] <= d.price_czk:
                continue
            self.store.put(
                PRICE_HISTORY,
                key,
                {"canonical": d.canonical, "chain": d.chain, "day": day, "price_czk": d.price_czk},
            )

    def insight(self, query: str, current_best: float | None) -> PriceInsight:
        canonical = canonical_for(query)
        since = utcnow() - timedelta(days=90)
        rows = [r for r in self.store.list_raw(PRICE_HISTORY, since=since) if r["canonical"] == canonical]
        history = sorted(
            (
                PriceHistoryPoint(
                    day=date.fromisoformat(r["day"]), chain=r["chain"], price_czk=r["price_czk"]
                )
                for r in rows
            ),
            key=lambda p: p.day,
        )
        if not history or current_best is None:
            return PriceInsight(
                canonical=canonical,
                current_best=current_best,
                lowest_90d=None,
                average_90d=None,
                verdict="unknown",
                message="Na posouzení ceny zatím nemám dost historie.",
                history=history,
            )
        prices = [p.price_czk for p in history]
        lowest, avg = min(prices), sum(prices) / len(prices)
        if current_best <= lowest * 1.02:
            verdict, msg = "buy_now", f"Kup teď, {czk(current_best)} je nejnižší cena za poslední 3 měsíce."
        elif current_best <= avg:
            verdict, msg = "good", f"Dobrá cena, pod průměrem {czk(avg)}."
        else:
            verdict, msg = "wait", f"Vyplatí se počkat, bývá i za {czk(lowest)}."
        return PriceInsight(
            canonical=canonical,
            current_best=current_best,
            lowest_90d=lowest,
            average_90d=round(avg, 1),
            verdict=verdict,
            message=msg,
            history=history[-60:],
        )

    def seed_demo_history(self, today: date | None = None) -> None:
        """Demo: syntetická historie cen, ať graf a doporučení 'kup teď' mají z čeho počítat."""
        import hashlib

        from ..food.catalog import CATALOG

        today = today or date.today()
        for spec in CATALOG[:30]:
            for chain in ("Albert", "Lidl", "Billa", "Kaufland", "Penny"):
                for back in range(0, 84, 7):
                    day = today - timedelta(days=back)
                    h = int(hashlib.sha256(f"{spec.key}{chain}{back}".encode()).hexdigest()[:6], 16)
                    price = round((spec.typical_price_czk or 30) * (0.62 + (h % 45) / 100), 1)
                    self.store.put(
                        PRICE_HISTORY,
                        f"{spec.key}:{chain}:{day.isoformat()}",
                        {"canonical": spec.key, "chain": chain, "day": day.isoformat(), "price_czk": price},
                        ts=datetime.combine(day, datetime.min.time()).astimezone(),
                    )
