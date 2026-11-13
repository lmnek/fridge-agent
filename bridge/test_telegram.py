import os
import tempfile
import time

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="fridge-test-"))
os.environ["OPENAI_API_KEY"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import camera  # noqa: E402
import main  # noqa: E402
import telegram  # noqa: E402

CART = {
    "type": "cart",
    "items": [
        {"name": "Kunín lactose-free milk 1.5 %, 1 l", "qty": 4, "price_czk": 34, "reason": "ran out, lactose-free"},
        {"name": "Guanciale, 200 g", "qty": 1.0, "price_czk": 189, "reason": "for carbonara"},
    ],
    "total_czk": 812,
}

# The A–H fixture run (app/src/stage/cards/fixtures.ts) without captions and tool calls, which Telegram ignores.
RUN = [
    {"type": "stage", "beat": "A", "action": "reset"},
    {"type": "stage", "beat": "B", "action": "start"},
    {"type": "vision", "phase": "analysing", "run": "r1"},
    {"type": "vision", "phase": "done", "run": "r1", "removed": ["Lactose-free milk", "Eggs"], "added": []},
    {"type": "learned", "fact": "Craving carbonara tonight", "category": "craving"},
    {"type": "stage", "beat": "C", "action": "start"},
    CART,
    {"type": "stage", "beat": "DE", "action": "play"},
    {"type": "stage", "beat": "F", "action": "call"},
    {"type": "call", "phase": "dialing", "number": "+420 *** *** 482"},
    {"type": "call", "phase": "ringing", "number": "+420 *** *** 482"},
    {"type": "call", "phase": "answered", "number": "+420 *** *** 482"},
    {"type": "call", "phase": "ended", "number": "+420 *** *** 482"},
    {"type": "stage", "beat": "G", "action": "delivered"},
    {"type": "stage", "beat": "H", "action": "telegram"},
    {"type": "stage", "beat": "idle", "action": "idle"},
]

CHAT = [
    "Lactose-free milk and eggs just ran out. I'll put them in the next order.",
    "Noted. Craving carbonara tonight. I'll plan the order around it.",
    "Your Rohlík cart is ready, 812 Kč:\n\n"
    "4 × Kunín lactose-free milk 1.5 %, 1 l (ran out, lactose-free)\n1 × Guanciale, 200 g (for carbonara)",
    "Order placed, 812 Kč. The courier is on the way.",
    "Calling the courier to tell them where to bring it.",
    "Talked to the courier. They're on their way up.",
    "Delivered. Enjoy dinner.",
]


@pytest.fixture(autouse=True)
def fake(monkeypatch):
    monkeypatch.setattr(telegram, "TOKEN", "")  # bridge/.env may hold a real token: tests never post
    monkeypatch.setattr(telegram, "CHAT_ID", "")


def said(events):
    chat = telegram.Chat()
    return [t for t in map(chat.say, events) if t]


def test_full_run_posts_each_beat_once():
    assert said(RUN) == CHAT
    beats = [e for e in RUN[1:] if e["type"] == "stage"]
    assert said(RUN + beats) == CHAT  # a beat forced again in the same run stays quiet...
    assert said(RUN + RUN) == CHAT + CHAT  # ...and a reset starts a new run


def test_cart_link_approval_and_other_facts():
    cart = said([CART | {"checkout_url": "https://www.rohlik.cz/objednavka/prehled-kosiku"}])[0]
    assert cart.endswith("\n\nCheck out here: https://www.rohlik.cz/objednavka/prehled-kosiku")
    approval = {"id": "a1", "total_czk": 812, "status": "pending"}
    assert said(
        [
            {"type": "approval", "approval": approval},
            {"type": "approval", "approval": approval | {"status": "approved"}, "order": {"total_czk": 812}},
            {"type": "stage", "beat": "DE"},  # the order was placed already
            {"type": "learned", "fact": "Anna is gluten-free", "category": "diet"},
            {"type": "call", "phase": "dialing"},
            {"type": "call", "phase": "ended", "error": "busy"},  # never answered: no message
        ]
    ) == [
        "The cart is waiting for your OK in the app, 812 Kč.",
        "Order placed, 812 Kč. The courier is on the way.",
        "Anna is gluten-free. I'll remember that.",
        "Calling the courier to tell them where to bring it.",
    ]


def test_bus_reaches_the_fake_chat(monkeypatch):
    monkeypatch.setattr(camera, "configured", lambda: False)  # no camera watcher from the lifespan
    with TestClient(main.app) as client:
        for event in RUN:
            assert client.post("/events", json=event).json()["ok"]
        deadline = time.time() + 3
        while client.get("/telegram").json()["messages"] != CHAT and time.time() < deadline:
            time.sleep(0.05)
        assert client.get("/telegram").json() == {"live": False, "messages": CHAT}
