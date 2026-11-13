"""API end-to-end v demo režimu (TestClient spouští i lifespan: seed, kamery, plánovač)."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from frida.main import create_app


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c


def test_status_and_inventory(client):
    status = client.get("/api/status").json()
    assert status["integrations"]["camera"] == "demo"
    assert status["integrations"]["agent"] == "demo"
    assert len(status["cameras"]) == 2
    inv = client.get("/api/inventory").json()
    assert inv["summary"]["total_items"] >= 25


def test_inventory_crud(client):
    item = client.post("/api/inventory", json={"name": "Hermelín", "quantity": 2}).json()
    assert item["canonical"] == "hermelin"
    item = client.post(f"/api/inventory/{item['id']}/consume", json={"amount": 1}).json()
    assert item["quantity"] == 1
    item = client.patch(f"/api/inventory/{item['id']}", json={"expires_on": "2030-01-01"}).json()
    assert item["expiry_source"] == "manual"
    assert client.delete(f"/api/inventory/{item['id']}?reason=wasted").status_code == 200
    assert client.delete("/api/inventory/nic").status_code == 404


def test_camera_snapshot_capture_and_simulation(client):
    r = client.get("/api/camera/cam0/snapshot.jpg")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.content[:2] == b"\xff\xd8"
    scene = client.get("/api/demo/scene").json()
    assert scene["enabled"] and scene["in_fridge"] and scene["can_add"]
    res = client.post("/api/camera/simulate", json={"action": "take", "item": "pivo"}).json()
    assert res["ok"]
    names = {i["canonical"] for i in client.get("/api/inventory").json()["items"]}
    assert "pivo" not in names
    obs = client.get("/api/observations?camera_id=cam0").json()
    assert obs and obs[0]["image_url"].startswith("/api/snapshots/")
    assert client.get(obs[0]["image_url"]).status_code == 200
    assert client.get("/api/snapshots/..%2F..%2Fetc%2Fpasswd").status_code in (400, 404)


def test_shopping_endpoints(client):
    deals = client.get("/api/deals", params={"q": "máslo"}).json()
    assert deals["deals"]
    plans = client.post("/api/deals/plan", json={}).json()
    assert {p["strategy"] for p in plans} >= {"cheapest_split"}
    cart = client.post("/api/grocery/fill-needs").json()
    assert cart["lines"] and cart["checkout_url"]
    assert client.get("/api/grocery/checkout").json()["url"].startswith("https://www.rohlik.cz/")
    craving = client.post("/api/craving", json={"text": "mám chuť na pizzu"}).json()
    assert craving["order_in"]
    recipes = client.get("/api/recipes").json()["recipes"]
    assert recipes
    cooked = client.post(f"/api/recipes/{recipes[0]['id']}/cooked", json=recipes[0]).json()
    assert cooked["used"]
    assert client.get("/api/analytics").json()["waste_by_month"]
    assert client.get("/api/stores").json()


def test_prefs_and_location(client):
    p = client.patch("/api/prefs", json={"diet": ["vegetarian"], "favorite_chains": ["Lidl"]}).json()
    assert p["diet"] == ["vegetarian"] and p["favorite_chains"] == ["Lidl"]
    loc = client.post("/api/location", json={"lat": 50.08, "lon": 14.42, "source": "browser"}).json()
    assert loc["label"]
    assert client.get("/api/prefs").json()["location"]["lat"] == 50.08


def test_websocket_streams_chat(client):
    with client.websocket_connect("/ws") as ws:
        hello = json.loads(ws.receive_text())
        assert hello["type"] == "hello" and hello["payload"]["agent"] == "scripted"
        assert json.loads(ws.receive_text())["type"] == "inventory"
        reply = client.post("/api/chat", json={"text": "co mám v lednici?"}).json()
        assert reply["conversation_id"] and "lednici" in reply["message"]["text"]
        types = []
        while "agent.done" not in types:
            types.append(json.loads(ws.receive_text())["type"])
        assert "agent.start" in types and "agent.tool" in types and "agent.delta" in types


def test_browser_call_flow(client):
    call = client.post("/api/calls", json={"reason": "Došlo mléko."}).json()
    assert call["status"] == "simulated"
    answered = client.post(f"/api/calls/{call['id']}/answer").json()
    assert answered["status"] == "in-progress" and answered["transcript"]
    reply = client.post(
        "/api/chat", json={"text": "nashle", "channel": "voice", "call_session_id": call["id"]}
    ).json()
    assert reply["hangup"] is True
    calls = client.get("/api/calls").json()
    assert calls[0]["status"] == "completed"
    assert [line["role"] for line in calls[0]["transcript"]] == ["assistant", "user", "assistant"]


def test_conversation_relay_websocket(client):
    """Stejné zprávy, jaké posílá Twilio ConversationRelay."""
    call = client.post("/api/calls", json={"reason": "Došlo mléko."}).json()
    with client.websocket_connect("/voice/relay") as ws:
        ws.send_text(
            json.dumps(
                {
                    "type": "setup",
                    "callSid": "CA123",
                    "customParameters": {"frida_session": call["id"], "reason": call["reason"]},
                }
            )
        )
        ws.send_text(json.dumps({"type": "prompt", "voicePrompt": "co se kazí?", "last": True}))
        tokens = []
        while True:
            msg = json.loads(ws.receive_text())
            assert msg["type"] == "text"
            if msg["last"]:
                break
            tokens.append(msg["token"])
        assert "".join(tokens).strip()
        ws.send_text(json.dumps({"type": "prompt", "voicePrompt": "díky, nashle", "last": True}))
        while True:
            msg = json.loads(ws.receive_text())
            if msg["type"] == "end":
                break
    session = next(c for c in client.get("/api/calls").json() if c["id"] == call["id"])
    assert any(line["role"] == "user" for line in session["transcript"])


def test_twilio_webhooks_require_signature_when_live(settings):
    live = settings.model_copy(
        update={
            "twilio_account_sid": "AC" + "0" * 32,
            "twilio_from_number": "+15005550006",
            "user_phone": "+420777123456",
            "public_base_url": "https://frida.example.org",
        }
    )
    live.twilio_auth_token = __import__("pydantic").SecretStr("secret")
    with TestClient(create_app(live)) as c:
        r = c.post("/voice/status", data={"CallSid": "CA1", "CallStatus": "completed"})
        assert r.status_code == 403


def test_unknown_api_paths_are_404_even_with_built_frontend(tmp_path, settings, monkeypatch):
    """SPA fallback vrací index.html jen pro stránky aplikace, ne pro /api a /voice."""
    import frida.main as main_mod

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Frida</title>")
    monkeypatch.setattr(main_mod, "FRONTEND_DIST", dist)
    with TestClient(main_mod.create_app(settings)) as c:
        assert c.get("/nakup").text.startswith("<!doctype html>")
        assert c.get("/api/neexistuje").status_code == 404
        assert c.get("/voice/neexistuje").status_code == 404
        assert c.get("/api/snapshots/..%2F..%2Fetc%2Fpasswd").status_code == 404
        assert c.get("/..%2Fbackend%2Fpyproject.toml").text.startswith("<!doctype html>")
