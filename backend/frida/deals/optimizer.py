"""Plánování nákupu: kde koupit, aby to vyšlo nejlevněji i s cestou.

Model nákladů (všechno v Kč, aby šlo sčítat):
- cena zboží (akční nebo běžná),
- každá zastávka navíc stojí `stop_cost_czk` (čas, fronta u pokladny),
- cesta stojí `km_cost_czk` za kilometr trasy domov -> obchody -> domov,
- položka, kterou v žádném obchodě plánu nemají, se počítá běžnou cenou
  s přirážkou, takže plány s plným pokrytím vyhrávají.

Kombinace obchodů se procházejí přesně (do `max_stops`), řetězců je v Praze
kolem deseti, takže je to pár set kombinací. Žádná heuristika, která by
mohla minout optimum.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass

from ..food.catalog import find_spec
from ..geo.service import haversine_m
from ..schemas import Deal, GeoPoint, PlanItem, PlanStop, ShoppingPlan, Store

MISSING_MARKUP = 1.3


@dataclass
class PlannerConfig:
    stop_cost_czk: float = 25.0
    km_cost_czk: float = 8.0
    max_stops: int = 3
    online_delivery_fee_czk: float = 49.0
    online_free_from_czk: float = 1200.0


def regular_price(query: str) -> float:
    spec = find_spec(query)
    return float(spec.typical_price_czk) if spec and spec.typical_price_czk else 40.0


def route_m(home: GeoPoint, stores: list[Store]) -> int:
    """Délka okruhu domov -> obchody -> domov (nejbližší soused, pro ≤ 3 zastávky stačí)."""
    if not stores:
        return 0
    left = list(stores)
    pos = (home.lat, home.lon)
    total = 0
    while left:
        nxt = min(left, key=lambda s: haversine_m(pos[0], pos[1], s.lat, s.lon))
        total += haversine_m(pos[0], pos[1], nxt.lat, nxt.lon)
        pos = (nxt.lat, nxt.lon)
        left.remove(nxt)
    return total + haversine_m(pos[0], pos[1], home.lat, home.lon)


def best_offer_per_chain(deals_by_query: dict[str, list[Deal]]) -> dict[str, dict[str, Deal]]:
    """{query: {chain: nejlevnější akce toho řetězce}}."""
    out: dict[str, dict[str, Deal]] = {}
    for query, deals in deals_by_query.items():
        per_chain: dict[str, Deal] = {}
        for d in deals:
            if d.chain not in per_chain or d.price_czk < per_chain[d.chain].price_czk:
                per_chain[d.chain] = d
        out[query] = per_chain
    return out


def _evaluate(
    chains: tuple[str, ...],
    offers: dict[str, dict[str, Deal]],
    stores: dict[str, Store],
    home: GeoPoint,
    cfg: PlannerConfig,
) -> tuple[float, list[PlanStop], list[str], float, float, int]:
    assignment: dict[str, list[PlanItem]] = {c: [] for c in chains}
    missing: list[str] = []
    goods = 0.0
    regular_total = 0.0
    for query, per_chain in offers.items():
        regular = regular_price(query)
        candidates = [(per_chain[c].price_czk, c) for c in chains if c in per_chain]
        if candidates:
            price, chain = min(candidates)
            deal = per_chain[chain]
            reg = deal.original_price_czk or regular
            assignment[chain].append(PlanItem(query=query, deal=deal, price_czk=price, regular_price_czk=reg))
            goods += price
            regular_total += reg
        else:
            missing.append(query)
            goods += regular * MISSING_MARKUP
            regular_total += regular
    used = [c for c in chains if assignment[c]]
    used_stores = [stores[c] for c in used if c in stores]
    travel = route_m(home, used_stores)
    cost = goods + cfg.stop_cost_czk * len(used) + cfg.km_cost_czk * travel / 1000
    stops = [
        PlanStop(
            kind="store",
            chain=c,
            store=stores.get(c),
            items=assignment[c],
            subtotal_czk=round(sum(i.price_czk or 0 for i in assignment[c]), 1),
        )
        for c in used
    ]
    return cost, stops, missing, goods, regular_total, travel


def plan_shopping(
    deals_by_query: dict[str, list[Deal]],
    *,
    home: GeoPoint,
    stores_by_chain: dict[str, Store],
    online_prices: dict[str, float] | None = None,
    favorite_chains: list[str] | None = None,
    cfg: PlannerConfig | None = None,
) -> list[ShoppingPlan]:
    """Vrátí plány seřazené od nejlepšího: nejlevnější rozdělení, jeden obchod, online."""
    cfg = cfg or PlannerConfig()
    offers = best_offer_per_chain(deals_by_query)
    chains = sorted({c for per in offers.values() for c in per if c in stores_by_chain})
    if favorite_chains:
        fav = set(favorite_chains)
        chains = [c for c in chains if c in fav] or chains
    plans: list[ShoppingPlan] = []

    best_split = None
    best_single = None
    for k in range(1, min(cfg.max_stops, len(chains)) + 1):
        for combo in itertools.combinations(chains, k):
            result = _evaluate(combo, offers, stores_by_chain, home, cfg)
            if best_split is None or result[0] < best_split[0]:
                best_split = result
            if k == 1 and (best_single is None or result[0] < best_single[0]):
                best_single = result

    def make(strategy: str, title: str, res, explanation: str) -> ShoppingPlan:
        cost, stops, missing, goods, regular_total, travel = res
        total = round(sum(s.subtotal_czk for s in stops), 1)
        return ShoppingPlan(
            strategy=strategy,  # type: ignore[arg-type]
            title=title,
            stops=stops,
            total_czk=total,
            regular_total_czk=round(regular_total, 1),
            savings_czk=round(max(0.0, sum(i.regular_price_czk or 0 for s in stops for i in s.items) - total), 1),
            travel_m=travel,
            missing=missing,
            score=round(cost, 1),
            explanation=explanation,
        )

    if best_split is not None:
        stops = best_split[1]
        names = ", ".join(s.chain for s in stops)
        plans.append(
            make(
                "cheapest_split",
                f"Nejvýhodněji: {names}",
                best_split,
                f"Celkem {len(stops)} {'obchod' if len(stops) == 1 else 'obchody'}, trasa "
                f"{best_split[5] / 1000:.1f} km. Započítaná je i cesta a čas na každou zastávku.",
            )
        )
    if best_single is not None and (best_split is None or len(best_split[1]) > 1):
        chain = best_single[1][0].chain if best_single[1] else "?"
        plans.append(
            make(
                "single_store",
                f"Všechno v jednom: {chain}",
                best_single,
                "Jen jedna zastávka. Může vyjít o něco dráž, ale ušetří čas.",
            )
        )
    if online_prices:
        lines = []
        total = 0.0
        regular_total = 0.0
        missing = []
        for query in deals_by_query:
            price = online_prices.get(query)
            reg = regular_price(query)
            if price is None:
                missing.append(query)
                continue
            lines.append(PlanItem(query=query, price_czk=price, regular_price_czk=reg))
            total += price
            regular_total += reg
        fee = 0.0 if total >= cfg.online_free_from_czk else cfg.online_delivery_fee_czk
        missing_cost = sum(regular_price(q) * MISSING_MARKUP for q in missing)
        plans.append(
            ShoppingPlan(
                strategy="online_delivery",
                title="Dovézt z Rohlíku",
                stops=[PlanStop(kind="online", chain="Rohlík", items=lines, subtotal_czk=round(total, 1))],
                total_czk=round(total + fee, 1),
                regular_total_czk=round(regular_total, 1),
                savings_czk=round(max(0.0, regular_total - total), 1),
                travel_m=0,
                missing=missing,
                score=round(total + fee + missing_cost, 1),
                explanation=f"Bez cesty, doprava {fee:.0f} Kč. Košík naplním, objednávku potvrdíš v Rohlíku.",
            )
        )
    return sorted(plans, key=lambda p: p.score)
