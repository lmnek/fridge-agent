"""Claude vision: co jde do API (model, effort, fallback, obrázek) a jak se odpověď převede na detekce."""

from __future__ import annotations

import base64
import io
from datetime import UTC, date, datetime
from types import SimpleNamespace

import pytest
from PIL import Image

from frida.camera.base import Frame
from frida.vision.base import VisionContext, VisionUnavailable
from frida.vision.claude import ClaudeVisionProvider, _SceneReading, _SeenItem


def _jpeg(w: int = 2560, h: int = 1440) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 210, 220)).save(buf, "JPEG")
    return buf.getvalue()


def _item(**kw) -> _SeenItem:
    base = dict(
        label="mléko",
        catalog_key="mleko",
        category="dairy",
        box_x=0.1,
        box_y=0.2,
        box_w=0.1,
        box_h=0.3,
        confidence=0.9,
        count=None,
        fill_level=None,
        shelf="door",
        expiry_text=None,
    )
    base.update(kw)
    return _SeenItem(**base)


class FakeMessages:
    def __init__(self, reading: _SceneReading | None, stop_reason: str = "end_turn") -> None:
        self.reading = reading
        self.stop_reason = stop_reason
        self.calls: list[dict] = []

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason=self.stop_reason, parsed_output=self.reading, stop_details=None)


def _client(messages: FakeMessages):
    return SimpleNamespace(beta=SimpleNamespace(messages=messages))


def _frame() -> Frame:
    return Frame(camera_id="cam0", jpeg=_jpeg(), taken_at=datetime.now(UTC), width=2560, height=1440)


async def test_request_and_mapping(settings):
    reading = _SceneReading(
        door_open=True,
        note="",
        items=[
            _item(expiry_text="SPOTŘEBUJTE DO 21.11.2026", box_w=1.4, confidence=1.2),
            _item(label="kimchi", catalog_key="other", category="ferment", shelf="nahore", count=1),
        ],
    )
    messages = FakeMessages(reading)
    provider = ClaudeVisionProvider(_client(messages), settings)  # type: ignore[arg-type]
    out = await provider.analyze(_frame(), VisionContext(camera_name="Dveře", today_iso="2026-11-13"))

    call = messages.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["output_config"] == {"effort": "high"}
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert "thinking" not in call and "temperature" not in call
    image = call["messages"][0]["content"][0]
    assert image["type"] == "image" and image["source"]["media_type"] == "image/jpeg"
    sent = Image.open(io.BytesIO(base64.b64decode(image["source"]["data"])))
    assert max(sent.size) == 1568, "obrázek se zmenší na delší hranu 1568 px"

    milk, other = out
    assert milk.canonical == "mleko" and milk.source == "claude"
    assert milk.expires_on == date(2026, 11, 21)
    assert milk.bbox.w == 1.0 and milk.confidence == 1.0, "hodnoty mimo 0..1 se oříznou"
    assert other.canonical == "kimchi" and other.category == "other" and other.shelf == "unknown"


async def test_refusal_and_no_key(settings):
    messages = FakeMessages(None, stop_reason="refusal")
    provider = ClaudeVisionProvider(_client(messages), settings)  # type: ignore[arg-type]
    assert await provider.analyze(_frame(), VisionContext(camera_name="Police")) == []

    with pytest.raises(VisionUnavailable):
        await ClaudeVisionProvider(None, settings).analyze(_frame(), VisionContext(camera_name="Police"))
