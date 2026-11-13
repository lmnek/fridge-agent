"""Beat B: what left the fridge.

The door opens (motion starts) and the hub's cameras take BEFORE frames. While it stays open the newest lit
frames become AFTER. When motion settles, one vision call compares them and returns boxes plus what was
removed or added. The bridge updates the inventory, and the `vision` events drive the B card. The `done`
event carries `tell`, the line the kitchen app hands to its Realtime session so Coldex reacts.

    POST /vision/look            manual: hub snapshots, or {"frames": [data URL]} from the webcam
    POST /vision/replay          runs the saved B frames through the same pipeline (the fallback hotkey)
    POST /vision/keep?name=b     saves the last run as a replay
    GET  /vision/runs/<run>/<file>.jpg

Events (docs/handoffs/README.md): vision {phase: captured | analysing | done, run, reason, frames, boxes,
removed, added, tell}. Every box has frame (index into frames), label, x, y, w, h (0..1) and status
(out, new or in).
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import secrets
import shutil
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel

import camera

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
VISION_MODEL = os.getenv("VISION_MODEL", "gpt-5.5")
VISION_EFFORT = os.getenv("VISION_EFFORT", "low")
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT.parent / "data"))
RUNS = DATA_DIR / "vision"
LAST = RUNS / "last"  # the newest AFTER frame per camera, the BEFORE of the next manual look
REPLAY = ROOT / "replay"
REPLAY_SECONDS = 2.5  # HACK(demo): the replay takes as long as a real analysis, so the card looks the same

router = APIRouter(prefix="/vision")
_lock = asyncio.Lock()


class _Hooks:
    emit: Callable[..., None] = staticmethod(lambda kind, **data: None)
    items: Callable[[], list[dict[str, Any]]] = staticmethod(lambda: [])
    apply: Callable[[list[str], list[dict[str, Any]]], None] = staticmethod(lambda removed, added: None)


hooks = _Hooks()


def attach(emit: Callable[..., None], items: Callable[[], list[dict[str, Any]]], apply: Callable[..., None]) -> None:
    """main.py hands over the event bus and the inventory, so this file never imports main."""
    hooks.emit, hooks.items, hooks.apply = emit, items, apply


# --------------------------------------------------------------------------- the vision call

PROMPT = """\
You are the eyes of a fridge. The photos come from cameras inside one fridge. BEFORE photos show the
fridge when the door opened, AFTER photos show it just before the door closed. A line like
"Image 2: AFTER, camera 0" comes before each photo.

The inventory lists what the household believes is inside. When something you see matches an inventory
item, use that exact name.

- removed: inventory items you can see in a BEFORE photo that are gone from the AFTER photo of the same
  camera. Box each one where it stood in the BEFORE photo.
- added: things in an AFTER photo that were not in the BEFORE photo of the same camera. A short English
  name, qty only when obvious ("6", "1 l"), expires only when a date is clearly printed (YYYY-MM-DD).
  Box each one in the AFTER photo.
- seen: every other food or drink you can see in the AFTER photos, boxed in the AFTER photo.
- lit: false when the AFTER photos are dark or black-and-white infrared.

With no BEFORE photos, leave removed and added empty and put everything under seen. Be conservative:
something that only moved, or is hidden behind something else, is neither removed nor added.

Boxes: image is the photo number, x and y the top-left corner, w and h the size, all in thousandths of
the photo's width and height (0 to 1000). Box tightly around the one item."""

_BOX = {
    "type": "object",
    "additionalProperties": False,
    "required": ["image", "x", "y", "w", "h"],
    "properties": {k: {"type": "integer"} for k in ("image", "x", "y", "w", "h")},
}
_THING = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name", "box"],
    "properties": {"name": {"type": "string"}, "box": _BOX},
}
_ADDED = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name", "qty", "expires", "box"],
    "properties": {
        "name": {"type": "string"},
        "qty": {"type": ["string", "null"]},
        "expires": {"type": ["string", "null"]},
        "box": _BOX,
    },
}
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["lit", "removed", "added", "seen"],
    "properties": {
        "lit": {"type": "boolean"},
        "removed": {"type": "array", "items": _THING},
        "added": {"type": "array", "items": _ADDED},
        "seen": {"type": "array", "items": _THING},
    },
}


def _data_url(jpeg: bytes, edge: int = 1536) -> str:
    with Image.open(io.BytesIO(jpeg)) as img:
        img = img.convert("RGB")
        img.thumbnail((edge, edge))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


async def analyse(frames: list[dict[str, Any]], names: list[str]) -> dict[str, Any]:
    """One structured vision call over every frame. `frames` carry when, camera and jpeg."""
    if not OPENAI_API_KEY:
        raise HTTPException(503, "OPENAI_API_KEY is not set in bridge/.env.")
    content: list[dict[str, Any]] = [
        {"type": "input_text", "text": f"Inventory: {', '.join(names) or 'empty'}."},
    ]
    for n, f in enumerate(frames, 1):
        content.append({"type": "input_text", "text": f"Image {n}: {f['when'].upper()}, camera {f['camera']}"})
        content.append({"type": "input_image", "image_url": _data_url(f["jpeg"]), "detail": "high"})
    body: dict[str, Any] = {
        "model": VISION_MODEL,
        "instructions": PROMPT,
        "input": [{"role": "user", "content": content}],
        "text": {"format": {"type": "json_schema", "name": "fridge_change", "strict": True, "schema": SCHEMA}},
        "reasoning": {"effort": VISION_EFFORT},
    }
    async with httpx.AsyncClient(timeout=90) as client:
        headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
        res = await client.post("https://api.openai.com/v1/responses", headers=headers, json=body)
        if res.status_code == 400 and "reasoning" in res.text:  # a model without reasoning settings
            body.pop("reasoning")
            res = await client.post("https://api.openai.com/v1/responses", headers=headers, json=body)
    if res.status_code != 200:
        raise HTTPException(502, f"Vision ({VISION_MODEL}): {res.text[:300]}")
    for item in res.json().get("output", []):
        for part in item.get("content") or []:
            if part.get("type") == "output_text":
                return json.loads(part["text"])
    raise HTTPException(502, f"Vision ({VISION_MODEL}) returned no text.")


# --------------------------------------------------------------------------- the pipeline


def _boxes(result: dict[str, Any], count: int) -> list[dict[str, Any]]:
    out = []
    for key, status in (("removed", "out"), ("added", "new"), ("seen", "in")):
        for thing in result.get(key, []):
            b = thing["box"]
            if not 1 <= b["image"] <= count:
                continue
            clamp = lambda v: max(0.0, min(1.0, v / 1000))  # noqa: E731
            out.append(
                {
                    "frame": b["image"] - 1,
                    "label": thing["name"],
                    "status": status,
                    "x": clamp(b["x"]),
                    "y": clamp(b["y"]),
                    "w": clamp(b["w"]),
                    "h": clamp(b["h"]),
                }
            )
    return out


def tell_line(removed: list[str], added: list[str]) -> str | None:
    """What the kitchen session hears. The wording matches try_demo.py, which part 3 tunes the prompt with."""
    if not removed and not added:
        return None
    parts = []
    if removed:
        parts.append(f"Vision saw these taken out: {', '.join(removed)}.")
    if added:
        parts.append(f"Vision saw these put in: {', '.join(added)}.")
    return f"[camera] The fridge door just closed. {' '.join(parts)} Update the inventory, then react briefly."


async def pipeline(
    before: dict[str, bytes],
    after: dict[str, bytes],
    reason: str,
    cached: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Frames in, `vision` events out. Live snapshots, the webcam and the replay all come through here."""
    if _lock.locked():
        return None  # one run at a time, a second door event during analysis is dropped
    async with _lock:
        run = f"{datetime.now():%H%M%S}-{secrets.token_hex(2)}"
        folder = RUNS / run
        folder.mkdir(parents=True, exist_ok=True)
        frames: list[dict[str, Any]] = []
        for when, group in (("before", before), ("after", after)):
            for cam, jpeg in group.items():
                name = f"{when}_{cam}.jpg"
                (folder / name).write_bytes(jpeg)
                frames.append({"when": when, "camera": cam, "jpeg": jpeg, "url": f"/api/vision/runs/{run}/{name}"})
        public = [{k: v for k, v in f.items() if k != "jpeg"} for f in frames]
        hooks.emit("vision", phase="captured", run=run, reason=reason, frames=public)
        hooks.emit("vision", phase="analysing", run=run)
        t0 = time.monotonic()
        try:
            if cached is not None:
                await asyncio.sleep(REPLAY_SECONDS)
                result = cached
            else:
                result = await analyse(frames, [i["name"] for i in hooks.items()])
        except Exception as e:  # the card must leave "analysing" even when the call fails
            detail = getattr(e, "detail", None) or str(e)
            hooks.emit("vision", phase="done", run=run, frames=public, boxes=[], removed=[], added=[], error=detail)
            hooks.emit("system", message=f"Vision failed: {detail}")
            return None
        (folder / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
        removed = [t["name"] for t in result.get("removed", [])]
        added = [t["name"] for t in result.get("added", [])]
        hooks.apply(removed, [{k: t.get(k) for k in ("name", "qty", "expires")} for t in result.get("added", [])])
        LAST.mkdir(parents=True, exist_ok=True)
        for cam, jpeg in after.items():
            (LAST / f"{cam}.jpg").write_bytes(jpeg)
        payload = {
            "run": run,
            "frames": public,
            "boxes": _boxes(result, len(frames)),
            "removed": removed,
            "added": added,
            "lit": result.get("lit", True),
            "seconds": round(time.monotonic() - t0, 1),
            "tell": tell_line(removed, added),
        }
        hooks.emit("vision", phase="done", **payload)
        return payload


def _last() -> dict[str, bytes]:
    return {p.stem: p.read_bytes() for p in sorted(LAST.glob("*.jpg"))} if LAST.exists() else {}


async def _snap_all(lit_only: bool = False) -> dict[str, bytes]:
    shots = await asyncio.gather(*(camera.snap(ch) for ch in camera.CHANNELS), return_exceptions=True)
    out = {}
    for ch, shot in zip(camera.CHANNELS, shots, strict=True):
        if isinstance(shot, bytes) and (not lit_only or camera.lit(shot)):
            out[str(ch)] = shot
    return out


async def look_hub(reason: str = "manual") -> None:
    after = await _snap_all()
    if not after:
        hooks.emit("system", message="No camera answered. Check REOLINK_HOST and that the hub is on this network.")
        return
    hooks.emit("look", reason=reason)
    last = _last()
    await pipeline({k: v for k, v in last.items() if k in after}, after, reason)


async def watch() -> None:
    """Door opens: BEFORE frames. While open: keep the newest lit frames. Motion settles: run the pipeline.

    Polls the hub's motion state, which does not wake the cameras. Fridge cameras go dark the moment the door
    shuts, so the AFTER frame is the last lit one taken while it was still open.
    """
    was, before, after = False, {}, {}
    while True:
        await asyncio.sleep(1.5)
        try:
            now = await camera.moving(camera.CHANNELS[0])
        except Exception:
            continue
        try:
            if now and not was:
                hooks.emit("look", reason="motion")
                before, after = await _snap_all(lit_only=True) or _last(), {}
            elif now:
                after.update(await _snap_all(lit_only=True))
            elif was:
                after.update(await _snap_all(lit_only=True))
                if after:
                    asyncio.create_task(pipeline({k: v for k, v in before.items() if k in after}, after, "motion"))
        except Exception as e:  # a flaky snapshot must not kill the watcher
            hooks.emit("system", message=f"Camera: {e}")
        was = now


# --------------------------------------------------------------------------- endpoints


class LookIn(BaseModel):
    frames: list[str] = []  # data URLs from the webcam when there is no hub


def _decode(data_url: str) -> bytes:
    return base64.b64decode(data_url.split(",", 1)[-1])


@router.post("/look")
async def look(body: LookIn | None = None) -> dict[str, Any]:
    if body and body.frames:
        # HACK(demo): without the hub, the laptop webcam stands in for the fridge cameras.
        after = {"webcam" if i == 0 else f"webcam{i}": _decode(f) for i, f in enumerate(body.frames)}
        last = _last()
        asyncio.create_task(pipeline({k: v for k, v in last.items() if k in after}, after, "manual"))
        return {"ok": True, "source": "webcam"}
    if not camera.configured():
        raise HTTPException(409, "No hub configured and no webcam frames sent.")
    asyncio.create_task(look_hub())
    return {"ok": True, "source": "hub"}


@router.post("/replay")
async def replay(name: str = "b") -> dict[str, Any]:
    """HACK(demo): the fallback for B. Saved real frames, and the saved result if there is one."""
    folder = REPLAY / name
    if not folder.exists():
        raise HTTPException(404, f"No replay frames in bridge/replay/{name}/.")

    def pick(when: str) -> dict[str, bytes]:  # before_0.jpg, after_1.jpg, or a phone's plain before.jpg
        files = sorted(folder.glob(f"{when}*.jpg"))
        return {(p.stem.split("_", 1)[1] if "_" in p.stem else "0"): p.read_bytes() for p in files}

    result = folder / "result.json"
    cached = json.loads(result.read_text()) if result.exists() else None
    hooks.emit("look", reason="replay")
    asyncio.create_task(pipeline(pick("before"), pick("after"), "replay", cached))
    return {"ok": True, "cached": cached is not None}


@router.post("/keep")
def keep(name: str = "b") -> dict[str, Any]:
    """Saves the newest run as bridge/replay/<name>/, so a rehearsal's real frames become the fallback."""
    runs = sorted((p for p in RUNS.glob("*-*") if (p / "result.json").exists()), key=lambda p: p.stat().st_mtime)
    if not runs:
        raise HTTPException(404, "No finished vision run yet.")
    target = REPLAY / name
    shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(runs[-1], target)
    return {"ok": True, "saved": f"bridge/replay/{name}", "from": runs[-1].name}


@router.get("/runs/{run}/{file}")
def frame(run: str, file: str) -> FileResponse:
    path = (RUNS / run / file).resolve()
    if RUNS.resolve() not in path.parents or not path.exists():
        raise HTTPException(404)
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
