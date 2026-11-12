"""Mock vision pro demo: vrací 'pravdu' z demo kamery.

U skutečné kamery nemá co vrátit (ground_truth je None), takže prázdný seznam.
Pipeline v takovém případě nic neodebírá, protože prázdný výsledek bez
obrázku znamená "nevím", ne "lednice je prázdná".
"""

from __future__ import annotations

from ..camera.base import Frame
from ..schemas import Detection
from .base import VisionContext


class MockVisionProvider:
    name = "mock"

    async def analyze(self, frame: Frame, context: VisionContext) -> list[Detection]:
        return [d.model_copy() for d in (frame.ground_truth or [])]
