"""Akce, plán nákupu, historie cen, recepty, rozvoz."""

from __future__ import annotations

from datetime import date, timedelta

from frida.deals.optimizer import PlannerConfig, plan_shopping
from frida.deals.service import DealService, excluded
from frida.food.delivery import detect_cuisine, search_links
from frida.food.recipes import builtin_suggestions, craving_tags
from frida.schemas import Deal, GeoPoint, InventoryItem, Store
from frida.seed import seed_demo

HOME = GeoPoint(lat=50.0755, lon=14.4378)


def _store(chain: str, dlat: float) -> Store:
    return Store(id=f"s-{chain}", chain=chain, name=chain, lat=HOME.lat + dlat, lon=HOME.lon)


def _deal(chain: str, query: str, price: float, original: float) -> Deal:
    return Deal(
        id=f"{chain}-{query}",
        product_name=query,
        canonical=query,
        chain=chain,
        price_czk=price,
        original_price_czk=original,
        source="test",
    )


def test_plan_prefers_split_when_savings_beat_travel():
    deals = {
        "maslo": [_deal("Lidl", "maslo", 30, 72), _deal("Albert", "maslo", 70, 72)],
        "mleko": [_deal("Albert", "mleko", 12, 55), _deal("Lidl", "mleko", 50, 55)],
    }
    # druhá zastávka stojí 25 Kč + cesta, úspora 38 Kč na mléku se vyplatí
    stores = {"Lidl": _store("Lidl", 0.003), "Albert": _store("Albert", -0.003)}
    plans = plan_shopping(deals, home=HOME, stores_by_chain=stores, online_prices={"maslo": 50, "mleko": 22})
    best = plans[0]
    assert best.strategy == "cheapest_split"
    assert {s.chain for s in best.stops} == {"Lidl", "Albert"}
    assert best.total_czk == 42
    assert {p.strategy for p in plans} == {"cheapest_split", "single_store", "online_delivery"}


def test_plan_single_store_when_travel_is_expensive():
    deals = {
        "maslo": [_deal("Lidl", "maslo", 30, 60), _deal("Albert", "maslo", 31, 60)],
        "mleko": [_deal("Albert", "mleko", 20, 25), _deal("Lidl", "mleko", 21, 25)],
    }
    stores = {"Lidl": _store("Lidl", 0.02), "Albert": _store("Albert", -0.02)}  # na opačných stranách, 2+ km
    plans = plan_shopping(deals, home=HOME, stores_by_chain=stores, cfg=PlannerConfig(stop_cost_czk=25))
    assert len(plans[0].stops) == 1


def test_excluded_products():
    assert excluded("maslo", "Rama Classic rostlinný tuk 400 g")
    assert excluded("maslo", "Perla Tip margarín")
    assert not excluded("maslo", "Máslo Tatra 82 % tuku 250 g")


async def test_deal_service_search_and_insight(services):
    await seed_demo(services)
    res = await services.deals.search("máslo", location=HOME)
    assert res.canonical == "maslo"
    assert res.deals and res.best is not None
    assert all(d.nearest_store is not None for d in res.deals)
    assert (
        res.deals == sorted(res.deals, key=lambda d: d.price_czk)
        or res.best.chain in services.settings.favorite_chains
    )
    insight = services.deals.insight("máslo", 1.0)
    assert insight.verdict == "buy_now"
    assert services.deals.insight("máslo", 10_000).verdict == "wait"


async def test_deal_service_survives_broken_source(services):
    class Broken:
        name = "broken"

        async def search(self, query):
            raise RuntimeError("down")

    svc = DealService(services.settings, services.store, services.geo, [Broken(), *services.deals.sources])
    res = await svc.search("mléko", location=HOME)
    assert res.deals
    assert "broken" in (res.note or "")


def _item(canonical: str, name: str, days_left: int | None, status: str = "ok") -> InventoryItem:
    from frida.db import utcnow

    return InventoryItem(
        id=f"i-{canonical}",
        name=name,
        canonical=canonical,
        added_at=utcnow(),
        quantity=1,
        days_left=days_left,
        status=status,
        expires_on=date.today() + timedelta(days=days_left or 0),
    )


def test_builtin_recipes_rescue_expiring_and_skip_expired():
    items = [
        _item("vejce", "Vejce", 10),
        _item("rajcata", "Rajčata", 1, "expiring"),
        _item("mlete-maso", "Mleté maso", -1, "expired"),
    ]
    recipes = builtin_suggestions(items)
    assert recipes[0].id == "shakshuka"
    assert recipes[0].rescue_score > 0
    assert not any("Mleté maso" in r.uses for r in recipes)


def test_cravings_and_delivery_links():
    assert "pizza" in craving_tags("mám chuť na pizzu")
    assert detect_cuisine("dal bych si sushi") == "sushi"
    links = search_links("pizza", HOME)
    assert {v.provider for v in links} == {"wolt-link", "foodora-link"}
    assert all(v.url.startswith("https://") for v in links)


async def test_craving_answer(services):
    await seed_demo(services)
    answer = await services.recipes.craving("mám chuť na pizzu", services.inventory.list(), location=HOME)
    assert answer.order_in
    assert answer.cook_now or answer.buy_and_cook
    assert answer.message
