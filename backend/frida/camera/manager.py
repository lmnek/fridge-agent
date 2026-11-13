"""Správce kamer: spouštěče -> snímky -> vision pipeline.

Strategie pro bateriové kamery uvnitř lednice:
- Při otevření dveří (PIR / pohyb / dveřní senzor) počkáme, až se rozsvítí a
  obraz se ustálí, a uděláme snímek.
- Dokud jsou dveře otevřené, fotíme v delších intervalech (max. pár snímků),
  aby poslední snímek před zavřením zachytil konečný stav.
- Po zavření je v lednici tma, takže snímek po zavření nemá smysl.
- Když dveře zůstanou otevřené déle než `door_open_alert_seconds`, přijde upozornění.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import datetime

from ..bus import EventBus
from ..config import Settings
from ..db import DocStore, utcnow
from ..events import EventLog
from ..schemas import CameraInfo, Observation
from ..vision.pipeline import VisionPipeline
from .base import Camera, CameraTrigger
from .demo import DemoWorld

log = logging.getLogger(__name__)

DOOR_OPENS = "door_opens"
BURST_INTERVAL = 5.0
BURST_MAX = 5


class CameraManager:
    def __init__(
        self,
        *,
        settings: Settings,
        cameras: list[Camera],
        pipeline: VisionPipeline,
        events: EventLog,
        bus: EventBus,
        store: DocStore,
        demo_world: DemoWorld | None = None,
        hub=None,
    ) -> None:
        self.settings = settings
        self.cameras: dict[str, Camera] = {c.id: c for c in cameras}
        self.pipeline = pipeline
        self.events = events
        self.bus = bus
        self.store = store
        self.demo_world = demo_world
        self.hub = hub
        self.door_open: dict[str, bool] = {c.id: False for c in cameras}
        self.opened_at: dict[str, datetime] = {}
        self._bursts: dict[str, asyncio.Task] = {}
        self._tasks: list[asyncio.Task] = []
        self._locks: dict[str, asyncio.Lock] = {c.id: asyncio.Lock() for c in cameras}

    # ------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        if self.hub is not None:
            self._tasks.append(asyncio.create_task(self._consume_hub_events(), name="reolink-events"))
        self._tasks.append(asyncio.create_task(self._door_watchdog(), name="door-watchdog"))

    async def stop(self) -> None:
        for task in [*self._tasks, *self._bursts.values()]:
            task.cancel()
        for task in [*self._tasks, *self._bursts.values()]:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        if self.hub is not None:
            await self.hub.close()

    async def _consume_hub_events(self) -> None:
        channels = [c.channel for c in self.cameras.values()]
        while True:
            try:
                async for trig in self.hub.events(channels):
                    await self.handle_trigger(trig)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("camera events: %s, zkusím to znovu za 15 s", exc)
                await asyncio.sleep(15)

    # ------------------------------------------------------------- triggers
    async def handle_trigger(self, trig: CameraTrigger) -> None:
        cam = self.cameras.get(trig.camera_id)
        if cam is None:
            log.warning("trigger pro neznámou kameru %s", trig.camera_id)
            return
        if trig.kind in ("door_open", "motion"):
            if not self.door_open[cam.id]:
                self._set_door(cam.id, True)
            if cam.id not in self._bursts or self._bursts[cam.id].done():
                self._bursts[cam.id] = asyncio.create_task(self._burst(cam.id))
        elif trig.kind == "door_closed":
            self._set_door(cam.id, False)
        elif trig.kind in ("manual", "schedule"):
            await self.capture(cam.id, reason=trig.kind)

    def _set_door(self, camera_id: str, is_open: bool) -> None:
        self.door_open[camera_id] = is_open
        if self.demo_world is not None:
            self.demo_world.door_open = is_open or any(self.door_open.values())
        self.bus.publish("door", {"camera_id": camera_id, "open": is_open})
        if is_open:
            self.opened_at[camera_id] = utcnow()
            now = utcnow()
            self.store.put(
                DOOR_OPENS,
                f"{camera_id}_{now.timestamp():.0f}",
                {"camera_id": camera_id, "ts": now.isoformat()},
            )
        else:
            self.opened_at.pop(camera_id, None)

    async def _burst(self, camera_id: str) -> None:
        await asyncio.sleep(self.settings.snapshot_settle_seconds)
        shots = 0
        while self.door_open.get(camera_id) and shots < BURST_MAX:
            await self.capture(camera_id, reason="door")
            shots += 1
            await asyncio.sleep(BURST_INTERVAL)

    async def capture(self, camera_id: str, *, reason: str = "manual") -> Observation | None:
        cam = self.cameras[camera_id]
        async with self._locks[camera_id]:
            try:
                frame = await cam.snapshot()
            except Exception as exc:
                log.warning("snapshot %s selhal: %s", camera_id, exc)
                self.events.emit(
                    "system",
                    f"Kamera {cam.name} neodpovídá",
                    detail=str(exc)[:200],
                    severity="warning",
                    camera_id=camera_id,
                )
                return None
            obs = await self.pipeline.process(frame, camera_name=cam.name, reason=reason)
            self.bus.publish("camera", await cam.info())
            return obs

    async def _door_watchdog(self) -> None:
        alerted: set[str] = set()
        while True:
            await asyncio.sleep(5)
            now = utcnow()
            for cam_id, since in list(self.opened_at.items()):
                if (
                    now - since
                ).total_seconds() > self.settings.door_open_alert_seconds and cam_id not in alerted:
                    alerted.add(cam_id)
                    self.events.emit(
                        "door_open_too_long",
                        "Lednice je otevřená už přes "
                        + str(self.settings.door_open_alert_seconds // 60)
                        + " minuty",
                        detail="Zavři dveře, ať se nezkazí jídlo a lednice zbytečně nežere proud.",
                        severity="critical",
                        camera_id=cam_id,
                    )
            alerted &= set(self.opened_at)

    # ------------------------------------------------------------- info
    async def infos(self) -> list[CameraInfo]:
        return [await c.info() for c in self.cameras.values()]

    def door_opens_by_hour(self, tz) -> list[int]:
        hours = [0] * 24
        today = utcnow().astimezone(tz).date()
        for row in self.store.list_raw(DOOR_OPENS, limit=2000):
            ts = datetime.fromisoformat(row["ts"]).astimezone(tz)
            if ts.date() == today:
                hours[ts.hour] += 1
        return hours

    # ------------------------------------------------------------- demo
    async def simulate(
        self, action: str, item: str, *, amount: float = 0.35, expires_in_days: int | None = None
    ) -> dict:
        """Demo: otevře dveře, provede akci ve scéně, vyfotí a zavře."""
        if self.demo_world is None:
            raise RuntimeError("Simulace je dostupná jen v demo režimu kamery.")
        world = self.demo_world
        if action == "take":
            res = world.take(item)
        elif action == "use":
            res = world.use(item, amount)
        elif action == "put":
            obj = world.put(item, expires_in_days=expires_in_days)
            res = (("cam1" if obj and obj.spec.shelf == "door" else "cam0"), obj) if obj else None
        else:
            raise ValueError(f"Neznámá akce {action}")
        if res is None or res[1] is None:
            return {"ok": False, "message": f"'{item}' ve scéně není nebo pro něj není místo."}
        camera_id = res[0]
        self._set_door(camera_id, True)
        await asyncio.sleep(0.4)
        obs = await self.capture(camera_id, reason="door")
        await asyncio.sleep(0.6)
        self._set_door(camera_id, False)
        return {
            "ok": True,
            "camera_id": camera_id,
            "observation_id": obs.id if obs else None,
            "message": f"{action}: {res[1].spec.name}",
        }
