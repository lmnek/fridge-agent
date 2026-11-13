import json
import os
import shutil
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="fridge-test-"))
os.environ["OPENAI_API_KEY"] = ""

import httpx  # noqa: E402
import pytest  # noqa: E402
import respx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

loop = main.loop  # main imports loop at its end, so loop never comes first
client = TestClient(main.app)
REPLAY = Path(__file__).resolve().parent / "replay/loop"


@pytest.fixture(autouse=True)
def sandbox(tmp_path, monkeypatch):
    """A fresh bus log and proposal store, and a copy of memory/, so the real files never change."""
    memory = tmp_path / "memory"
    shutil.copytree(main.MEMORY_DIR, memory)
    monkeypatch.setattr(loop, "BUS", tmp_path / "bus.jsonl")
    monkeypatch.setattr(loop, "STORE", tmp_path / "loop.json")
    monkeypatch.setattr(loop, "MEMORY_DIR", memory)
    yield memory
    main.reset()  # the other tests expect the seed fridge and an empty cart


def replay(name: str, start: float) -> None:
    events = [json.loads(line) for line in (REPLAY / name).read_text().splitlines()]
    with loop.BUS.open("a") as f:
        f.writelines(json.dumps({**e, "t": start + e["t"]}) + "\n" for e in events)


def test_the_bus_is_recorded_and_an_order_measured():
    client.post("/events", json={"type": "stage", "action": "reset"})
    client.post("/events", json={"type": "caption", "who": "actor", "text": "not recorded"})
    client.post("/tools/remember", json={"fact": "Kryštof is craving carbonara tonight.", "category": "craving"})
    eggs = {"name": "Eggs", "qty": 1, "price_czk": 64.9, "reason": "ran out"}
    client.post("/tools/show_cart", json={"items": [eggs]})
    kinds = [json.loads(line)["type"] for line in loop.BUS.read_text().splitlines()]
    assert "caption" not in kinds and {"stage", "tool", "learned", "cart"} <= set(kinds)
    [order] = loop.orders()
    assert order["tools"] == ["remember", "show_cart"] and order["learned"] and order["corrected"] == 0


def test_one_full_loop_on_recorded_data(sandbox):
    replay("before.jsonl", time.time() - 4 * 3600)
    assert loop.summary(loop.orders())["repeats"] > 0

    loop._auto_review()  # self-driving: six orders since the last proposal, so it reviews itself
    [p] = loop.proposals()
    assert p["status"] == "pending" and p["file"] == "instructions.md" and "get_inventory" in p["replace"]
    assert p["metric"] == "tool_calls" and p["expected"] < p["baseline"]["tool_calls"]
    assert client.post("/loop/review").json()["proposal"]["id"] == p["id"]  # one at a time
    assert p["replace"] not in (sandbox / "instructions.md").read_text()  # nothing changes before a person says so

    decided = client.post(f"/loop/proposals/{p['id']}", json={"approved": True}).json()
    assert decided["status"] == "approved"
    assert p["replace"] in (sandbox / "instructions.md").read_text()
    assert p["replace"] not in (main.MEMORY_DIR / "instructions.md").read_text()

    [measured] = client.get("/loop/state").json()["proposals"]
    assert measured["measured"]["verdict"].startswith("measuring")
    replay("after.jsonl", decided["applied_at"] + 60)
    x = client.get("/loop/state").json()["proposals"][0]["measured"]
    assert (x["before"]["orders"], x["after"]["orders"], x["verdict"]) == (6, 4, "helped")
    assert x["after"]["tool_calls"] < x["before"]["tool_calls"] and x["after"]["seconds"] < x["before"]["seconds"]
    assert "helped" in client.get("/loop").text


def test_rejected_and_stale_proposals_change_nothing(sandbox):
    replay("before.jsonl", time.time() - 4 * 3600)
    original = (sandbox / "instructions.md").read_text()
    p = client.post("/loop/review").json()["proposal"]
    assert client.post(f"/loop/proposals/{p['id']}", json={"approved": False}).json()["status"] == "rejected"
    assert (sandbox / "instructions.md").read_text() == original
    assert client.post("/loop/review").json()["proposal"] is None  # the stand-in doesn't propose it again

    loop._save([p | {"status": "pending"}])
    (sandbox / "instructions.md").write_text(original.replace(p["find"], "## Orders\n\n"))  # part 3 edited it
    assert client.post(f"/loop/proposals/{p['id']}", json={"approved": True}).status_code == 409
    assert client.post(f"/loop/proposals/{p['id']}", json={"approved": True}).status_code == 409


@respx.mock
def test_a_live_review_is_one_llm_call(monkeypatch):
    monkeypatch.setattr(loop, "LLM", True)
    replay("before.jsonl", time.time() - 4 * 3600)
    draft = {
        "file": "household.md",
        "find": "## Weekly basics\n",
        "replace": "## Weekly basics\n\nLooked up once per order.\n",
        "reason": "Because.",
        "metric": "seconds",
        "expected": 10.5,
    }
    output = [{"content": [{"type": "output_text", "text": json.dumps(draft)}]}]
    route = respx.post("https://api.openai.com/v1/responses")
    route.mock(return_value=httpx.Response(200, json={"output": output}))
    p = client.post("/loop/review").json()["proposal"]
    assert route.call_count == 1 and p["metric"] == "seconds" and p["file"] == "household.md"
    body = json.loads(route.calls[0].request.content)
    assert "instructions.md" in body["text"]["format"]["schema"]["properties"]["file"]["enum"]
    assert "get_inventory" in body["input"]
