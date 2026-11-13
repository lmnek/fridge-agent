"""Složení aplikace: která implementace se použije, rozhoduje konfigurace.

Pravidlo: každá integrace má demo variantu, která se zapne sama, když chybí
klíč nebo adresa. Aplikace tak jde spustit bez jediné proměnné prostředí
a skutečná zařízení a služby se připojují postupně (viz docs/napojeni.md).
"""

from __future__ import annotations

import asyncio
import contextlib
import importlib
import logging
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from anthropic import AsyncAnthropic

from .agent.brain import AgentBrain
from .ai import make_client
from .bus import EventBus
from .camera.base import Camera
from .camera.demo import DemoCamera, DemoWorld
from .camera.manager import CameraManager
from .config import Settings
from .db import DocStore, utcnow
from .deals.base import DealSource
from .deals.demo import DemoDealSource
from .deals.service import DealService
from .events import EventLog
from .food.delivery import DeliveryProvider, DemoDeliveryProvider, LinksOnlyDeliveryProvider
from .food.products import BarcodeService
from .food.recipes import RecipeService
from .geo.service import GeoService
from .grocery.base import GroceryProvider
from .grocery.mock import DemoGroceryProvider
from .inventory import InventoryService
from .notify import NotificationService
from .prefs import PrefsService
from .vision.base import VisionProvider
from .vision.claude import ClaudeVisionProvider
from .vision.mock import MockVisionProvider
from .vision.pipeline import CascadeProvider, VisionPipeline
from .voice.service import VoiceService

log = logging.getLogger(__name__)

DEAL_SOURCES = {
    "akcniceny": ("frida.deals.akcniceny", "AkcnicenyDealSource"),
    "kupi": ("frida.deals.kupi", "KupiDealSource"),
}


@dataclass
class Services:
    settings: Settings
    store: DocStore
    bus: EventBus
    events: EventLog
    inventory: InventoryService
    prefs: PrefsService
    geo: GeoService
    deals: DealService
    grocery: GroceryProvider
    delivery: DeliveryProvider
    recipes: RecipeService
    barcode: BarcodeService
    voice: VoiceService
    notify: NotificationService
    vision: VisionProvider
    claude_vision: ClaudeVisionProvider
    pipeline: VisionPipeline
    cameras: CameraManager
    client: AsyncAnthropic | None
    demo_world: DemoWorld | None = None
    hub: object | None = None
    agent: AgentBrain = field(init=False)
    started_at: datetime = field(default_factory=utcnow)
    _tasks: list[asyncio.Task] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.agent = AgentBrain(self, self.client)

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.settings.timezone)

    def integration_modes(self) -> dict[str, str]:
        modes = self.settings.integration_modes()
        modes["vision"] = getattr(self.vision, "name", modes["vision"])
        modes["agent"] = "live" if self.client else "demo"
        return modes

    async def start(self) -> None:
        if self.hub is not None:
            try:
                await self.hub.connect()  # type: ignore[attr-defined]
            except Exception as exc:
                log.warning("Reolink hub nedostupný: %s", exc)
                self.events.emit(
                    "system", "Kamera Reolink nedostupná", detail=str(exc)[:200], severity="warning"
                )
        await self.cameras.start()
        self._tasks.append(asyncio.create_task(self.notify.run_scheduler()))

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
            with contextlib.suppress(BaseException):
                await t
        await self.cameras.stop()
        await self.notify.close()
        for resource in (self.grocery, *self.deals.sources):
            close = getattr(resource, "aclose", None) or getattr(resource, "close", None)
            if close:
                with contextlib.suppress(Exception):
                    await close()
        if self.hub is not None:
            with contextlib.suppress(Exception):
                await self.hub.close()  # type: ignore[attr-defined]
        if self.client is not None:
            with contextlib.suppress(Exception):
                await self.client.close()
        self.store.close()


def _deal_sources(settings: Settings) -> list[DealSource]:
    if not settings.deals_live:
        return [DemoDealSource()]
    sources: list[DealSource] = []
    for name in settings.deals_sources:
        target = DEAL_SOURCES.get(name)
        if target is None:
            log.warning("neznámý zdroj akcí: %s", name)
            continue
        module = importlib.import_module(target[0])
        sources.append(getattr(module, target[1])(settings))
    return sources or [DemoDealSource()]


def _vision(settings: Settings, client: AsyncAnthropic | None) -> tuple[VisionProvider, ClaudeVisionProvider]:
    claude = ClaudeVisionProvider(client, settings)
    choice = settings.resolved_vision_provider
    if choice == "claude" and client is not None:
        return claude, claude
    if choice in ("local", "cascade"):
        from .vision.local_vit import LocalViTProvider

        local = LocalViTProvider(settings)
        if choice == "local":
            return local, claude
        return CascadeProvider(local, claude if client else None, settings.cascade_escalate_below), claude
    return MockVisionProvider(), claude


def _grocery(settings: Settings) -> GroceryProvider:
    if settings.has_rohlik:
        from .grocery.rohlik_mcp import RohlikMcpProvider

        return RohlikMcpProvider(settings)
    return DemoGroceryProvider()


def build_services(settings: Settings) -> Services:
    store = DocStore(settings.sqlite_url)
    bus = EventBus()
    events = EventLog(store, bus)
    inventory = InventoryService(store, bus, events, tz=settings.timezone)
    prefs = PrefsService(settings, store)
    geo = GeoService(settings, store)
    deals = DealService(settings, store, geo, _deal_sources(settings))
    client = make_client(settings)
    delivery: DeliveryProvider = (
        LinksOnlyDeliveryProvider() if settings.delivery_live else DemoDeliveryProvider()
    )
    recipes = RecipeService(settings, client, delivery)
    voice = VoiceService(settings, store, bus, events)
    notify = NotificationService(settings, store, bus, events, voice, inventory, prefs)
    vision, claude_vision = _vision(settings, client)
    pipeline = VisionPipeline(
        provider=vision,
        store=store,
        bus=bus,
        events=events,
        inventory=inventory,
        snapshots_dir=settings.snapshots_dir,
    )

    demo_world: DemoWorld | None = None
    hub = None
    cameras: list[Camera] = []
    names = settings.reolink_camera_names
    if settings.has_reolink:
        from .camera.reolink import ReolinkCamera, ReolinkHub

        hub = ReolinkHub(settings)
        for n, ch in enumerate(settings.reolink_channels):
            cameras.append(
                ReolinkCamera(hub, settings, f"cam{n}", names[n] if n < len(names) else f"Kamera {n + 1}", ch)
            )
    else:
        demo_world = DemoWorld()
        demo_world.seed_default()
        cameras = [DemoCamera(demo_world, "cam0", names[0], 0), DemoCamera(demo_world, "cam1", names[1], 1)]

    manager = CameraManager(
        settings=settings,
        cameras=cameras,
        pipeline=pipeline,
        events=events,
        bus=bus,
        store=store,
        demo_world=demo_world,
        hub=hub,
    )
    return Services(
        settings=settings,
        store=store,
        bus=bus,
        events=events,
        inventory=inventory,
        prefs=prefs,
        geo=geo,
        deals=deals,
        grocery=_grocery(settings),
        delivery=delivery,
        recipes=recipes,
        barcode=BarcodeService(settings, store),
        voice=voice,
        notify=notify,
        vision=vision,
        claude_vision=claude_vision,
        pipeline=pipeline,
        cameras=manager,
        client=client,
        demo_world=demo_world,
        hub=hub,
    )
