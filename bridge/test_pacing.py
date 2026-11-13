import asyncio
import json
import os
import tempfile
import time

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="fridge-test-"))
os.environ["OPENAI_API_KEY"] = ""
os.environ["REOLINK_HOST"] = ""

import httpx  # noqa: E402

import main  # noqa: E402
import pacing  # noqa: E402


class _Tap:
    def __init__(self) -> None:
        self.got: list[tuple[float, dict]] = []

    def put_nowait(self, message: str) -> None:
        self.got.append((time.monotonic(), json.loads(message)))


def _run(scenario):
    async def go():
        pacing.cancel()
        tap = _Tap()
        main._subscribers.add(tap)  # type: ignore[arg-type]
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://t") as c:
                await scenario(c, tap)
        finally:
            main._subscribers.discard(tap)  # type: ignore[arg-type]

    asyncio.run(go())


RECIPE = {"title": "Carbonara", "have": ["Eggs"], "missing": ["Guanciale"], "steps": ["Cook."]}


def test_tool_answers_now_and_its_events_land_later_in_order():
    async def scenario(c, tap):
        t0 = time.monotonic()
        res = await c.post("/tools/show_recipe", json=RECIPE, headers={"X-Coldex-Show-In": "500", "X-Coldex-Screen": "kitchen"})
        assert res.status_code == 200 and time.monotonic() - t0 < 0.3
        assert tap.got == []
        await asyncio.sleep(0.7)
        kinds = [(e["type"], e.get("phase")) for _, e in tap.got]
        assert kinds == [("tool", "start"), ("recipe", None), ("tool", "done")]
        assert 0.4 < tap.got[0][0] - t0 < 0.7

    _run(scenario)


def test_back_to_back_tools_dwell_apart():
    async def scenario(c, tap):
        h = {"X-Coldex-Show-In": "0", "X-Coldex-Screen": "stage"}
        t0 = time.monotonic()
        await c.post("/tools/show_recipe", json=RECIPE, headers=h)
        await c.post("/tools/view_cart", headers=h)
        await asyncio.sleep(pacing.CARD_MIN_DWELL_S + 0.3)
        starts = [(t, e["name"]) for t, e in tap.got if e["type"] == "tool" and e["phase"] == "start"]
        assert [n for _, n in starts] == ["show_recipe", "view_cart"]
        assert starts[0][0] - t0 < 0.2
        assert starts[1][0] - starts[0][0] >= pacing.CARD_MIN_DWELL_S - 0.05

    _run(scenario)


def test_stage_reset_cancels_pending_and_is_never_held():
    async def scenario(c, tap):
        await c.post("/tools/show_recipe", json=RECIPE, headers={"X-Coldex-Show-In": "400", "X-Coldex-Screen": "stage"})
        await c.post("/events", json={"type": "stage", "action": "reset"})
        assert any(e["type"] == "stage" for _, e in tap.got)
        await asyncio.sleep(0.6)
        assert not any(e["type"] in ("tool", "recipe") for _, e in tap.got)

    _run(scenario)


def test_no_header_publishes_live():
    async def scenario(c, tap):
        await c.post("/tools/get_inventory")
        assert [e.get("phase") for _, e in tap.got if e["type"] == "tool"] == ["start", "done"]

    _run(scenario)
