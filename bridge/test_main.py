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
    assert "place_order" not in {t.get("name") for t in tools}


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


def test_show_cart_and_shops_publish_the_table_shapes():
    import asyncio

    queue: asyncio.Queue[str] = asyncio.Queue()
    main._subscribers.add(queue)
    items = [
        {"name": "Lactose-free milk", "qty": 4, "price_czk": 34, "reason": "ran out"},
        {"name": "Bananas", "qty": 2, "price_czk": 47, "reason": "-20 % sale"},
    ]
    assert client.post("/tools/show_cart", json={"items": items}).json()["total_czk"] == 230
    client.post("/tools/show_shops", json={"choice": "Rohlík", "why": "delivers within the hour"})
    main._subscribers.discard(queue)
    events = {e["type"]: e for e in (json.loads(queue.get_nowait()) for _ in range(queue.qsize()))}
    cart = events["cart"]
    assert cart["total_czk"] == 230 and set(cart["items"][0]) == {"name", "qty", "price_czk", "reason", "image_url"}
    assert main.STATE["cart"] == cart["items"]  # the fake cart place_order approves
    deals = events["deals"]
    assert {"items", "stores", "scraped_at"} <= set(deals) and deals["choice"] == "Rohlík"
    assert "Bananas at Rohlík: 47 Kč, was 59 Kč (-20 %)" in main.memory()
