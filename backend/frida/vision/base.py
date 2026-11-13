"""Rozhraní pro rozpoznávání potravin ve snímku."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from ..camera.base import Frame
from ..schemas import Detection, InventoryItem


@dataclass
class VisionContext:
    """Co už o lednici víme. Pomáhá modelu držet konzistentní názvy a pozice."""

    camera_name: str
    known_items: list[InventoryItem] = field(default_factory=list)
    today_iso: str = ""


@runtime_checkable
class VisionProvider(Protocol):
    name: str

    async def analyze(self, frame: Frame, context: VisionContext) -> list[Detection]: ...


class VisionUnavailable(RuntimeError):
    """Poskytovatel není k dispozici (chybí klíč, knihovna nebo model)."""
