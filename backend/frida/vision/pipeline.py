"""Zpracování snímku: uložení, jas, změny, rozpoznání, zápis do inventáře.

Kaskáda (`FRIDA_VISION_PROVIDER=cascade`): nejdřív lokální ViT (rychlý,
soukromý, zdarma). Claude se zavolá jen když:
- si lokální model u něčeho není jistý (pod `FRIDA_CASCADE_ESCALATE_BELOW`),
- se objevila nová věc, kterou je dobré přesně pojmenovat,
- lokální model není k dispozici.
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import UTC
from pathlib import Path

from ..bus import EventBus
from ..camera.base import Frame
from ..camera.change import brightness, changed_regions
from ..db import DocStore
from ..events import EventLog
from ..inventory import InventoryService
from ..schemas import Detection, Observation
from .base import VisionContext, VisionProvider, VisionUnavailable

log = logging.getLogger(__name__)

OBSERVATIONS = "observations"
DARK = 0.16  # průměrný jas pod tím = tma, dveře zavřené


class CascadeProvider:
    name = "cascade"

    def __init__(self, local: VisionProvider, smart: VisionProvider | None, escalate_below: float) -> None:
        self.local = local
        self.smart = smart
        self.escalate_below = escalate_below

    async def analyze(self, frame: Frame, context: VisionContext) -> list[Detection]:
        try:
            local = await self.local.analyze(frame, context)
        except VisionUnavailable:
            if self.smart is None:
                raise
            return await self.smart.analyze(frame, context)
        known = {i.canonical for i in context.known_items}
        unsure = any(d.confidence < self.escalate_below for d in local)
        novel = any(d.canonical not in known for d in local)
        if self.smart is None or not (unsure or novel):
            return local
        try:
            smart = await self.smart.analyze(frame, context)
        except Exception as exc:
            log.warning("cascade: Claude selhal (%s), zůstávám u lokálního výsledku", exc)
            return local
        # Claude pojmenovává přesněji, lokální model ale může mít navíc věci, které Claude přehlédl.
        smart_keys = {d.canonical for d in smart}
        extra = [d for d in local if d.canonical not in smart_keys and d.confidence >= self.escalate_below]
        return smart + extra


class VisionPipeline:
    def __init__(
        self,
        *,
        provider: VisionProvider,
        store: DocStore,
        bus: EventBus,
        events: EventLog,
        inventory: InventoryService,
        snapshots_dir: Path,
    ) -> None:
        self.provider = provider
        self.store = store
        self.bus = bus
        self.events = events
        self.inventory = inventory
        self.snapshots_dir = snapshots_dir
        self._last_jpeg: dict[str, bytes] = {}
        self.latest: dict[str, Frame] = {}

    def latest_jpeg(self, camera_id: str) -> bytes | None:
        frame = self.latest.get(camera_id)
        if frame:
            return frame.jpeg
        path = self.snapshots_dir / f"{camera_id}_latest.jpg"
        return path.read_bytes() if path.exists() else None

    def _save(self, frame: Frame) -> str:
        stamp = frame.taken_at.astimezone(UTC).strftime("%Y%m%dT%H%M%S")
        name = f"{frame.camera_id}_{stamp}_{uuid.uuid4().hex[:4]}.jpg"
        (self.snapshots_dir / name).write_bytes(frame.jpeg)
        (self.snapshots_dir / f"{frame.camera_id}_latest.jpg").write_bytes(frame.jpeg)
        self._prune(frame.camera_id)
        return f"/api/snapshots/{name}"

    def _prune(self, camera_id: str, keep: int = 300) -> None:
        files = sorted(self.snapshots_dir.glob(f"{camera_id}_2*.jpg"))
        for old in files[:-keep]:
            old.unlink(missing_ok=True)

    async def process(self, frame: Frame, *, camera_name: str, reason: str = "trigger") -> Observation:
        started = time.perf_counter()
        image_url = self._save(frame)
        self.latest[frame.camera_id] = frame
        light = brightness(frame.jpeg)
        prev = self._last_jpeg.get(frame.camera_id)
        regions = changed_regions(prev, frame.jpeg) if light >= DARK else []
        detections: list[Detection] = []
        note = None
        dark = light < DARK or frame.door_open is False
        if dark:
            note = "Tma (dveře zavřené), rozpoznávání přeskočeno."
        elif prev is not None and not regions and reason not in ("manual", "scan"):
            note = "Beze změny od minulého snímku."
        else:
            known = [i for i in self.inventory.list(include_out=False) if i.camera_id == frame.camera_id]
            context = VisionContext(
                camera_name=camera_name, known_items=known, today_iso=self.inventory.today().isoformat()
            )
            try:
                detections = await self.provider.analyze(frame, context)
            except VisionUnavailable as exc:
                note = f"Rozpoznávání nedostupné: {exc}"
            except Exception as exc:
                log.exception("vision provider failed")
                note = f"Chyba rozpoznávání: {type(exc).__name__}"
        if not dark:
            self._last_jpeg[frame.camera_id] = frame.jpeg

        obs = Observation(
            id=f"obs_{uuid.uuid4().hex[:10]}",
            camera_id=frame.camera_id,
            taken_at=frame.taken_at,
            image_url=image_url,
            provider=getattr(self.provider, "name", "unknown"),
            detections=detections,
            latency_ms=int((time.perf_counter() - started) * 1000),
            brightness=round(light, 3),
            changed_regions=regions,
            note=note,
        )
        self.store.put(OBSERVATIONS, obs.id, obs, ts=obs.taken_at)
        self.bus.publish("observation", obs)
        # Inventář se upravuje jen podle snímku, na kterém model opravdu něco viděl.
        # Prázdný výsledek kvůli tmě nebo chybě neznamená prázdnou lednici.
        if detections:
            diff = self.inventory.apply_observation(obs)
            if diff.added or diff.removed or diff.changed:
                log.info(
                    "inventory diff cam=%s +%d -%d ~%d",
                    frame.camera_id,
                    len(diff.added),
                    len(diff.removed),
                    len(diff.changed),
                )
        return obs

    def recent(self, camera_id: str | None = None, limit: int = 20) -> list[Observation]:
        obs = self.store.list(OBSERVATIONS, Observation, limit=limit * 3 if camera_id else limit)
        if camera_id:
            obs = [o for o in obs if o.camera_id == camera_id][:limit]
        return obs
