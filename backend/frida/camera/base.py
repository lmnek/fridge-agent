"""Společné rozhraní kamer.

Každá kamera umí vrátit snímek (JPEG), popis sebe sama a případně odkaz na
živý přenos. Spouštěče (pohyb, otevření dveří) chodí jako `CameraTrigger`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Protocol, runtime_checkable

from ..schemas import CameraInfo, Detection, LiveStreamInfo

TriggerKind = Literal["motion", "door_open", "door_closed", "manual", "schedule"]


@dataclass
class Frame:
    camera_id: str
    jpeg: bytes
    taken_at: datetime
    width: int
    height: int
    # Jen demo kamera zná "pravdu" o scéně. Skutečné modely ji nikdy nedostanou,
    # používá ji pouze mock vision a testy.
    ground_truth: list[Detection] | None = None
    door_open: bool | None = None


@dataclass
class CameraTrigger:
    camera_id: str
    kind: TriggerKind
    at: datetime
    meta: dict[str, object] = field(default_factory=dict)


@runtime_checkable
class Camera(Protocol):
    id: str
    name: str
    channel: int

    async def snapshot(self) -> Frame: ...

    async def info(self) -> CameraInfo: ...

    def live_stream(self) -> LiveStreamInfo | None: ...


class TriggerSource(Protocol):
    def triggers(self) -> AsyncIterator[CameraTrigger]: ...
