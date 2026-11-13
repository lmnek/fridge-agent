"""The Reolink Home Hub on the LAN: snapshots and the motion state of its battery cameras.

Setup: SETUP.md (Reolink hub). Research and pitfalls: docs/integrace/reolink-kamera.md (Czech).
"""

from __future__ import annotations

import io
import os
import secrets
from pathlib import Path

import httpx
from dotenv import load_dotenv
from PIL import Image, ImageStat

load_dotenv(Path(__file__).resolve().parent / ".env")

HOST = os.getenv("REOLINK_HOST", "")
USER = os.getenv("REOLINK_USER", "admin")
PASSWORD = os.getenv("REOLINK_PASSWORD", "")
CHANNELS = [int(c) for c in os.getenv("REOLINK_CHANNELS", "0,1").split(",") if c.strip()]


class CameraError(RuntimeError):
    pass


def configured() -> bool:
    return bool(HOST and CHANNELS)


async def _api(params: dict[str, object], timeout: float = 20) -> httpx.Response:
    if not HOST:
        raise CameraError("No Reolink hub configured (REOLINK_HOST).")
    async with httpx.AsyncClient(verify=False, timeout=timeout) as client:  # the hub uses a self-signed cert
        try:
            return await client.get(
                f"https://{HOST}/cgi-bin/api.cgi", params={**params, "user": USER, "password": PASSWORD}
            )
        except httpx.HTTPError as e:
            raise CameraError(f"The hub at {HOST} does not answer: {e}") from e


async def snap(channel: int) -> bytes:
    """One JPEG. Wakes a sleeping battery camera, which takes a second or two."""
    res = await _api({"cmd": "Snap", "channel": channel, "rs": secrets.token_hex(4)})
    if res.status_code != 200 or not res.headers.get("content-type", "").startswith("image/"):
        raise CameraError(f"Snapshot from camera {channel} failed: {res.text[:200]}")
    return res.content


async def moving(channel: int) -> bool:
    """The hub's motion state. Asking does not wake the camera."""
    res = await _api({"cmd": "GetMdState", "channel": channel}, timeout=5)
    return bool(res.json()[0]["value"]["state"])


async def channels() -> list[dict[str, object]]:
    """What the hub reports for each channel, to set REOLINK_CHANNELS right (they can have gaps)."""
    res = await _api({"cmd": "GetChannelstatus"})
    return res.json()[0]["value"]["status"]


def lit(jpeg: bytes) -> bool:
    """True for a lit colour picture. False for a dark fridge or the black-and-white infrared night mode."""
    with Image.open(io.BytesIO(jpeg)) as img:
        small = img.convert("RGB").resize((64, 36))
    brightness = ImageStat.Stat(small.convert("L")).mean[0]
    px = small.tobytes()
    colour = sum(abs(px[i] - px[i + 1]) + abs(px[i + 1] - px[i + 2]) for i in range(0, len(px), 3)) / (64 * 36)
    return brightness > 35 and colour > 4  # colour is about 0 in infrared
