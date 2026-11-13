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
from ..text import km

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


Result = tuple[float, dict[str, list[tuple[str, Deal, float]]], list[str], float, int]


def _evaluate(
    chains: tuple[str, ...],
    offers: dict[str, dict[str, Deal]],
    regular: dict[str, float],
    stores: dict[str, Store],
    home: GeoPoint,
    cfg: PlannerConfig,
) -> Result:
    """Cena jedné kombinace obchodů. Jen čísla, objekty se staví až pro vítěze (běží stovkykrát)."""
    assignment: dict[str, list[tuple[str, Deal, float]]] = {}
    missing: list[str] = []
    goods = 0.0
    regular_total = 0.0
    for query, per_chain in offers.items():
        best: Deal | None = None
        for c in chains:
            d = per_chain.get(c)
            if d is not None and (best is None or d.price_czk < best.price_czk):
                best = d
        if best is not None:
            reg = best.original_price_czk or regular[query]
            assignment.setdefault(best.chain, []).append((query, best, reg))
            goods += best.price_czk
            regular_total += reg
        else:
            missing.append(query)
            goods += regular[query] * MISSING_MARKUP
            regular_total += regular[query]
    used = [c for c in chains if c in assignment]
    travel = route_m(home, [stores[c] for c in used if c in stores])
    cost = goods + cfg.stop_cost_czk * len(used) + cfg.km_cost_czk * travel / 1000
    return cost, {c: assignment[c] for c in used}, missing, regular_total, travel


def _stops(assignment: dict[str, list[tuple[str, Deal, float]]], stores: dict[str, Store]) -> list[PlanStop]:
    return [
        PlanStop(
            kind="store",
            chain=chain,
            store=stores.get(chain),
            items=[
                PlanItem(query=q, deal=d, price_czk=d.price_czk, regular_price_czk=reg) for q, d, reg in lines
            ],
            subtotal_czk=round(sum(d.price_czk for _, d, _ in lines), 1),
        )
        for chain, lines in assignment.items()
    ]


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
    regular = {q: regular_price(q) for q in offers}

    best_split: Result | None = None
    best_single: Result | None = None
    for k in range(1, min(cfg.max_stops, len(chains)) + 1):
        for combo in itertools.combinations(chains, k):
            result = _evaluate(combo, offers, regular, stores_by_chain, home, cfg)
            if best_split is None or result[0] < best_split[0]:
                best_split = result
            if k == 1 and (best_single is None or result[0] < best_single[0]):
                best_single = result

    def make(strategy: str, title: str, res: Result, explanation: str) -> ShoppingPlan:
        cost, assignment, missing, regular_total, travel = res
        stops = _stops(assignment, stores_by_chain)
        total = round(sum(s.subtotal_czk for s in stops), 1)
        return ShoppingPlan(
            strategy=strategy,  # type: ignore[arg-type]
            title=title,
            stops=stops,
            total_czk=total,
            regular_total_czk=round(regular_total, 1),
            savings_czk=round(
                max(0.0, sum(i.regular_price_czk or 0 for s in stops for i in s.items) - total), 1
            ),
            travel_m=travel,
            missing=missing,
            score=round(cost, 1),
            explanation=explanation,
        )

    if best_split is not None:
        used = list(best_split[1])
        plans.append(
            make(
                "cheapest_split",
                f"Nejvýhodněji: {', '.join(used)}",
                best_split,
                f"Celkem {len(used)} {'obchod' if len(used) == 1 else 'obchody'}, trasa "
                f"{km(best_split[4])}. Započítaná je i cesta a čas na každou zastávku.",
            )
        )
    if best_single is not None and (best_split is None or len(best_split[1]) > 1):
        chain = next(iter(best_single[1]), "?")
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
