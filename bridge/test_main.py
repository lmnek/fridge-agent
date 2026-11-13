import json
import os
import tempfile

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="fridge-test-")
os.environ["OPENAI_API_KEY"] = ""
os.environ["REOLINK_HOST"] = ""
os.environ["ROHLIK_TOKEN"] = ""

import httpx  # noqa: E402
import pytest  # noqa: E402
import respx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app)


def test_inventory_changes_add_update_remove():
    names = {i["name"] for i in client.get("/inventory").json()}
    assert "Lactose-free milk" in names
    res = client.post(
        "/inventory/changes",
        json={"added": [{"name": "Oat milk", "qty": "1 l", "expires": "2026-12-01"}], "removed": [{"name": "lactose-free milk"}]},
    ).json()
    names = {i["name"] for i in res["items"]}
    assert "Oat milk" in names and "Lactose-free milk" not in names
    client.post("/inventory/changes", json={"added": [{"name": "oat milk", "qty": "2 l"}]})
    oat = [i for i in client.get("/inventory").json() if i["name"].lower() == "oat milk"]
    assert len(oat) == 1 and oat[0]["qty"] == "2 l"


def test_order_needs_a_human_tap():
    assert client.post("/tools/place_order").json()["ok"] is False  # empty cart
    client.post("/tools/add_to_cart", json={"items": [{"name": "Guanciale", "qty": 1, "price_czk": 129.9}]})
    pending = client.post("/tools/place_order").json()
    assert pending["status"] == "waiting_for_approval" and pending["total_czk"] == 130
    assert main.STATE["orders"] == []
    done = client.post(f"/approvals/{pending['approval_id']}", json={"approved": True}).json()
    assert done["order"]["total_czk"] == 130 and main.STATE["cart"] == []
    assert client.post(f"/approvals/{pending['approval_id']}", json={"approved": True}).status_code == 404


def test_token_without_key_is_503():
    assert client.get("/realtime/token").status_code == 503


@respx.mock
def test_token_sends_full_session(monkeypatch):
    monkeypatch.setattr(main, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(main, "ROHLIK_TOKEN", "")  # other test files may import main before the env is blanked
    route = respx.post("https://api.openai.com/v1/realtime/client_secrets").mock(
        return_value=httpx.Response(200, json={"value": "ek_123", "expires_at": 0})
    )
    assert client.get("/realtime/token").json()["value"] == "ek_123"
    session = json.loads(route.calls.last.request.content)["session"]
    assert session["type"] == "realtime" and session["model"] == main.REALTIME_MODEL
    names = {t.get("name") for t in session["tools"]}
    assert {"update_inventory", "show_cart", "show_shops", "place_order"} <= names
    assert session["audio"]["input"]["transcription"]["model"] == main.REALTIME_TRANSCRIBE

    monkeypatch.setattr(main, "ROHLIK_TOKEN", "rohlik-oauth")
    client.get("/realtime/token")
    tools = json.loads(route.calls.last.request.content)["session"]["tools"]
    mcp = [t for t in tools if t["type"] == "mcp"]
    assert mcp and mcp[0]["authorization"] == "rohlik-oauth"
    # only read and cart tools reach the session, so nothing in it can order, cancel or claim
    assert "add_items_to_cart" in mcp[0]["allowed_tools"] and "cancel_order" not in mcp[0]["allowed_tools"]
    assert "place_order" in {t.get("name") for t in tools}  # staged approval only, never calls Rohlík


def test_camera_without_hub_is_404():
    assert client.get("/camera/0.jpg").status_code == 404


def test_remember_reaches_new_sessions_and_get_household():
    client.post("/tools/remember", json={"fact": "Kryštof is craving carbonara tonight.", "category": "craving"})
    assert "[craving] Kryštof is craving carbonara tonight." in main.session_config()["instructions"]
    memory = client.post("/tools/get_household").json()["memory"]
    assert "craving carbonara" in memory and "Anna" in memory and "Product picks" in memory


@respx.mock
def test_bad_rohlik_token_falls_back_to_demo_cart(monkeypatch):
    monkeypatch.setattr(main, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(main, "ROHLIK_TOKEN", "expired")
    route = respx.post("https://api.openai.com/v1/realtime/client_secrets").mock(
        side_effect=[httpx.Response(400, json={"error": "mcp auth"}), httpx.Response(200, json={"value": "ek_2"})]
    )
    body = client.get("/realtime/token").json()
    assert body == {"value": "ek_2", "model": main.REALTIME_MODEL, "rohlik": False}
    retry = json.loads(route.calls.last.request.content)["session"]["tools"]
    assert "place_order" in {t.get("name") for t in retry} and not [t for t in retry if t["type"] == "mcp"]


def test_bus_carries_tool_calls_and_published_events():
    import asyncio

    queue: asyncio.Queue[str] = asyncio.Queue()
    main._subscribers.add(queue)
    client.post("/tools/show_recipe", json={"title": "Carbonara", "missing": ["guanciale"]})
    client.post("/events", json={"type": "caption", "who": "actor", "text": "Ugh, again.", "kind": "final"})
    main._subscribers.discard(queue)
    events = [json.loads(queue.get_nowait()) for _ in range(queue.qsize())]
    tools = [e for e in events if e["type"] == "tool"]
    assert [e["phase"] for e in tools] == ["start", "done"] and tools[0]["args"]["title"] == "Carbonara"
    assert {"type": "caption", "who": "actor", "text": "Ugh, again.", "kind": "final"} in events


def test_show_cart_and_shops_publish_the_table_shapes(monkeypatch):
    import asyncio

    import show

    monkeypatch.setattr(show, "SAVED", main.DATA_DIR / "no-scrape.json")  # the sample, not part 8's saved scrape

    queue: asyncio.Queue[str] = asyncio.Queue()
    main._subscribers.add(queue)
    items = [  # names, quantities and reasons only: prices and pictures come from products.md
        {"name": "Lactose-free milk", "qty": 4, "reason": "lactose-free"},
        {"name": "Bananas", "qty": 6, "price_czk": 1, "reason": "-20 % sale"},  # a pick's price wins over the model's
        {"name": "Pancetta", "qty": 1, "price_czk": 79, "reason": "for carbonara"},  # no pick: the model's guess
    ]
    assert client.post("/tools/show_cart", json={"items": items}).json()["total_czk"] == 329  # 191.6 + 58.08 + 79
    client.post("/tools/show_shops", json={"choice": "Rohlík", "why": "delivers within the hour"})
    main._subscribers.discard(queue)
    events = {e["type"]: e for e in (json.loads(queue.get_nowait()) for _ in range(queue.qsize()))}
    cart = events["cart"]
    assert cart["total_czk"] == 329 and set(cart["items"][0]) == {"name", "qty", "price_czk", "reason", "image_url"}
    assert cart["items"][0]["price_czk"] == 47.9 and cart["items"][0]["image_url"].startswith("https://cdn.rohlik.cz/")
    assert cart["items"][2]["image_url"] == ""
    assert main.STATE["cart"] == cart["items"]  # the fake cart place_order approves
    deals = events["deals"]
    assert {"items", "stores", "scraped_at"} <= set(deals) and deals["choice"] == "Rohlík"
    assert "Bananas at Rohlík: 9.68 Kč, was 12.1 Kč (-20 %)" in main.memory()


def test_demo_cart_from_names_comes_to_the_picks_total(monkeypatch):
    import show

    monkeypatch.setattr(show, "_live", lambda pick: None)  # products.md's prices, not today's scraped ones
    names = ["Lactose-free milk", "Eggs", "Guanciale", "Spaghetti", "Gluten-free spaghetti", "Greek yogurt", "Bananas"]
    qty = {"Lactose-free milk": 4, "Guanciale": 2, "Greek yogurt": 4, "Bananas": 6}
    items = [{"name": n, "qty": qty.get(n, 1), "reason": "x"} for n in names]
    assert client.post("/tools/show_cart", json={"items": items}).json()["total_czk"] == 685
    assert all(i["image_url"] for i in main.STATE["cart"])
    # a looser name still finds its pick, and the longest pick name wins ("Gluten-free spaghetti" is not "Spaghetti")
    loose = [{"name": "milk", "qty": 4, "reason": "x"}, {"name": "Barilla gluten-free spaghetti", "qty": 1, "reason": "x"}]
    assert [i["price_czk"] for i in (client.post("/tools/show_cart", json={"items": loose}), main.STATE["cart"])[1]] == [47.9, 95.9]


def test_stage_reset_restores_the_seed_and_keeps_deals_and_frames():
    deals = main.DATA_DIR / "deals.json"
    frame = main.DATA_DIR / "vision" / "last" / "0.jpg"
    frame.parent.mkdir(parents=True, exist_ok=True)
    deals.write_text(json.dumps({"scraped_at": "07:30", "stores": [], "items": []}))
    frame.write_bytes(b"jpeg")
    client.post("/inventory/changes", json={"removed": [{"name": "Eggs"}]})
    client.post("/tools/show_cart", json={"items": [{"name": "Eggs", "qty": 1, "price_czk": 64.9, "reason": "ran out"}]})
    client.post("/tools/remember", json={"fact": "Craving carbonara.", "category": "craving"})
    client.post("/events", json={"type": "stage", "action": "reset"})
    assert "Eggs" in {i["name"] for i in client.get("/inventory").json()}
    assert main.STATE["cart"] == [] and main.STATE["approvals"] == {} and not main.NOTES_FILE.exists()
    assert deals.exists() and frame.exists()
    deals.unlink()
