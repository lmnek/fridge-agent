"""Kamera -> vision -> inventář na demo scéně (stejná cesta jako u skutečného Reolinku)."""

from __future__ import annotations

from datetime import timedelta

from frida.schemas import InventoryItemCreate, InventoryItemUpdate
from frida.seed import seed_demo


async def test_seed_fills_inventory_through_the_camera_pipeline(services):
    assert await seed_demo(services)
    items = services.inventory.list()
    canonicals = {i.canonical for i in items}
    assert {"mleko", "vejce", "jahody", "pivo"} <= canonicals
    assert all(i.camera_id in ("cam0", "cam1") for i in items if i.canonical != "smetana")
    summary = services.inventory.summary()
    assert summary.total_items >= 25
    assert 0 <= summary.freshness_score <= 100
    # druhé spuštění nic nepřidá
    assert not await seed_demo(services)


async def test_taking_a_staple_marks_it_out_and_calls(services):
    await seed_demo(services)
    res = await services.cameras.simulate("take", "mleko")
    assert res["ok"]
    milk = next(i for i in services.inventory.list() if i.canonical == "mleko")
    assert milk.status == "out"
    kinds = [e.kind for e in services.events.recent(20)]
    assert "item_out" in kinds
    # mléko + smetana = 2 došlé základní potraviny -> (simulovaný) hovor
    await services.notify.close()
    calls = services.voice.recent()
    assert calls and calls[0].status == "simulated"
    assert "mléko" in calls[0].reason


async def test_taking_a_non_staple_removes_it(services):
    await seed_demo(services)
    assert any(i.canonical == "pivo" for i in services.inventory.list())
    await services.cameras.simulate("take", "pivo")
    assert not any(i.canonical == "pivo" for i in services.inventory.list())


async def test_using_a_see_through_bottle_lowers_fill_level(services):
    await seed_demo(services)
    before = next(i for i in services.inventory.list() if i.canonical == "kecup")
    await services.cameras.simulate("use", "kecup", amount=0.3)
    after = next(i for i in services.inventory.list() if i.canonical == "kecup")
    assert after.fill_level < before.fill_level


async def test_invisible_change_is_not_guessed(services):
    """Hladina v neprůhledné krabici není na snímku vidět, takže se nic nemění (žádné vymýšlení)."""
    await seed_demo(services)
    before = next(i for i in services.inventory.list() if i.canonical == "dzus")
    await services.cameras.simulate("use", "dzus", amount=0.4)
    obs = services.pipeline.recent("cam1", 1)[0]
    assert obs.detections == []  # beze změny = vision se nevolá (u Claude to šetří peníze)
    after = next(i for i in services.inventory.list() if i.canonical == "dzus")
    assert after.fill_level == before.fill_level


async def test_putting_new_item_adds_it_with_expiry(services):
    await seed_demo(services)
    await services.cameras.simulate("put", "mozzarella", expires_in_days=5)
    item = next(i for i in services.inventory.list() if i.canonical == "mozzarella")
    assert item.days_left == 5
    assert item.expiry_source in ("ocr", "vision")


def test_status_rules(services):
    inv = services.inventory
    today = inv.today()
    ok = inv.create(InventoryItemCreate(name="Máslo", quantity=1, min_quantity=1, staple=True), emit=False)
    assert ok.status == "ok"  # poslední celé balení ještě nedochází
    low = inv.update(ok.id, InventoryItemUpdate(quantity=0.5))
    assert inv.get(low.id).status == "low"
    soon = inv.create(InventoryItemCreate(name="Jahody", expires_on=today + timedelta(days=1)), emit=False)
    assert soon.status == "expiring"
    old = inv.create(InventoryItemCreate(name="Šunka", expires_on=today - timedelta(days=1)), emit=False)
    assert old.status == "expired"


def test_wasted_removal_counts_money(services):
    inv = services.inventory
    item = inv.create(InventoryItemCreate(name="Losos", price_czk=120), emit=False)
    inv.remove(item.id, reason="wasted")
    assert inv.summary().waste_month_czk >= 120
    kinds = [e.kind for e in services.events.recent(5)]
    assert "item_removed" in kinds


def test_shopping_needs_include_out_staples(services):
    inv = services.inventory
    item = inv.create(InventoryItemCreate(name="Vejce", quantity=2, min_quantity=1, staple=True), emit=False)
    inv.remove(item.id)
    assert any(n.id == item.id for n in inv.shopping_needs())


async def test_manual_changes_do_not_come_back_as_camera_changes(services):
    """Vaření nebo smazání v aplikaci se promítne do simulované lednice.

    Jinak by příští otevření dveří (kdy se na stejné kameře změní něco jiného) nahlásilo
    falešnou změnu hladiny kečupu a pivo by se do lednice „vrátilo“.
    """
    await seed_demo(services)
    ketchup = next(i for i in services.inventory.list() if i.canonical == "kecup")
    beer = next(i for i in services.inventory.list() if i.canonical == "pivo")
    services.inventory.update(ketchup.id, InventoryItemUpdate(fill_level=0.17))
    services.inventory.remove(beer.id, reason="consumed")
    before = {e.id for e in services.events.recent(500)}

    await services.cameras.simulate("take", "horcice")  # dveře (kam1), vedle kečupu
    await services.cameras.simulate("take", "okurka")  # police (kam0), kde bylo pivo

    titles = [e.title for e in services.events.recent(500) if e.id not in before]
    assert not [t for t in titles if "Kečup" in t or "Pivo" in t], titles
    assert any("Hořčice" in t for t in titles), "skutečná změna se pořád hlásí"
    assert next(i for i in services.inventory.list() if i.canonical == "kecup").fill_level == 0.17
    assert not any(i.canonical == "pivo" for i in services.inventory.list())
