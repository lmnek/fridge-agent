import asyncio
import io
import json
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="fridge-test-"))
os.environ["OPENAI_API_KEY"] = ""
os.environ["REOLINK_HOST"] = ""

import httpx  # noqa: E402
import respx  # noqa: E402
from PIL import Image  # noqa: E402

import camera  # noqa: E402
import main  # noqa: E402
import vision  # noqa: E402


def jpeg(colour: tuple[int, int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (320, 180), colour).save(buf, "JPEG")
    return buf.getvalue()


def box(image: int) -> dict[str, int]:
    return {"image": image, "x": 100, "y": 200, "w": 300, "h": 400}


RESULT = {
    "lit": True,
    "removed": [{"name": "Eggs", "box": box(1)}, {"name": "Lactose-free milk", "box": box(1)}],
    "added": [],
    "seen": [{"name": "Butter", "box": box(2)}],
}


def test_lit_tells_a_lit_fridge_from_infrared() -> None:
    assert camera.lit(jpeg((220, 180, 90)))
    assert not camera.lit(jpeg((120, 120, 120)))  # black-and-white night mode
    assert not camera.lit(jpeg((10, 6, 4)))  # door shut


def test_tell_line_matches_the_kitchen_prompt() -> None:
    assert vision.tell_line([], []) is None
    line = vision.tell_line(["Lactose-free milk", "Eggs"], [])
    assert line == (
        "[camera] The fridge door just closed. Vision saw these taken out: Lactose-free milk, Eggs. "
        "The inventory is updated, react briefly."
    )


def test_pipeline_updates_inventory_and_emits_the_b_card(monkeypatch) -> None:
    events: list[tuple[str, dict]] = []
    monkeypatch.setattr(vision.hooks, "emit", lambda kind, **data: events.append((kind, data)))
    monkeypatch.setattr(vision, "REPLAY_SECONDS", 0)
    main.inventory_changes(main.Changes(added=[main.ItemIn(name="Eggs"), main.ItemIn(name="Lactose-free milk")]))

    done = asyncio.run(vision.pipeline({"0": jpeg((200, 170, 80))}, {"0": jpeg((190, 160, 70))}, "replay", RESULT))

    assert done, events
    assert done["removed"] == ["Eggs", "Lactose-free milk"]
    assert not {"Eggs", "Lactose-free milk"} & {i["name"] for i in main.inventory()}
    phases = [d["phase"] for k, d in events if k == "vision"]
    assert phases == ["captured", "analysing", "done"]
    out = [b for b in done["boxes"] if b["status"] == "out"]
    assert out[0]["frame"] == 0 and out[0]["x"] == 0.1 and out[0]["h"] == 0.4
    assert done["frames"][0]["url"].startswith("/api/vision/runs/") and "jpeg" not in done["frames"][0]
    assert "taken out" in done["tell"]


@respx.mock
def test_analyse_sends_frames_with_a_strict_schema(monkeypatch) -> None:
    monkeypatch.setattr(vision, "OPENAI_API_KEY", "sk-test")
    reply = {"output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(RESULT)}]}]}
    route = respx.post("https://api.openai.com/v1/responses").mock(return_value=httpx.Response(200, json=reply))
    frames = [
        {"when": "before", "camera": "0", "jpeg": jpeg((200, 170, 80))},
        {"when": "after", "camera": "0", "jpeg": jpeg((190, 160, 70))},
    ]
    result = asyncio.run(vision.analyse(frames, ["Eggs", "Lactose-free milk"]))
    assert result["removed"][0]["name"] == "Eggs"
    sent = json.loads(route.calls[0].request.content)
    assert sent["text"]["format"]["strict"] is True
    parts = sent["input"][0]["content"]
    assert [p["type"] for p in parts].count("input_image") == 2
    assert any(p.get("text") == "Image 1: BEFORE, camera 0" for p in parts)
