"""REST: inventář, kamery, vision, události, notifikace, hovory, analytika, nastavení."""

from __future__ import annotations

import asyncio
import re
import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from .. import __version__
from ..camera.base import CameraTrigger
from ..db import utcnow
from ..schemas import (
    Analytics,
    CallRequest,
    CallSession,
    CameraInfo,
    FridgeEvent,
    GeoPoint,
    InventoryItem,
    InventoryItemCreate,
    InventoryItemUpdate,
    Notification,
    Observation,
    SystemStatus,
    UserPreferences,
    UserPreferencesUpdate,
)
from ..seed import savings_month
from ..services import Services
from ..vision.base import VisionUnavailable
from .deps import get_svc

router = APIRouter(prefix="/api")
Svc = Annotated[Services, Depends(get_svc)]


# ----------------------------------------------------------------- stav
@router.get("/status", response_model=SystemStatus)
async def status(svc: Svc) -> SystemStatus:
    return SystemStatus(
        version=__version__,
        integrations=svc.integration_modes(),
        cameras=await svc.cameras.infos(),
        started_at=svc.started_at,
        now=utcnow(),
    )


# ----------------------------------------------------------------- inventář
@router.get("/inventory")
async def inventory(svc: Svc) -> dict:
    return {
        "items": [i.model_dump(mode="json") for i in svc.inventory.list()],
        "summary": svc.inventory.summary().model_dump(mode="json"),
    }


@router.post("/inventory", response_model=InventoryItem)
async def create_item(data: InventoryItemCreate, svc: Svc) -> InventoryItem:
    return svc.inventory.create(data, source="manual")


def _item_or_404(item: InventoryItem | None) -> InventoryItem:
    if item is None:
        raise HTTPException(404, "Položka neexistuje")
    return item


@router.patch("/inventory/{item_id}", response_model=InventoryItem)
async def update_item(item_id: str, patch: InventoryItemUpdate, svc: Svc) -> InventoryItem:
    return _item_or_404(svc.inventory.update(item_id, patch))


@router.delete("/inventory/{item_id}", response_model=InventoryItem)
async def remove_item(
    item_id: str, svc: Svc, reason: Literal["consumed", "wasted"] = "consumed"
) -> InventoryItem:
    return _item_or_404(svc.inventory.remove(item_id, reason=reason))


class AmountIn(BaseModel):
    amount: float | None = Field(default=None, gt=0)


@router.post("/inventory/{item_id}/consume", response_model=InventoryItem)
async def consume_item(item_id: str, body: AmountIn, svc: Svc) -> InventoryItem:
    return _item_or_404(svc.inventory.consume(item_id, body.amount))


@router.post("/inventory/{item_id}/restock", response_model=InventoryItem)
async def restock_item(item_id: str, body: AmountIn, svc: Svc) -> InventoryItem:
    return _item_or_404(svc.inventory.restock(item_id, body.amount))


@router.get("/events", response_model=list[FridgeEvent])
async def events(svc: Svc, limit: int = 50) -> list[FridgeEvent]:
    return svc.events.recent(min(limit, 200))


# ----------------------------------------------------------------- kamery
@router.get("/cameras", response_model=list[CameraInfo])
async def cameras(svc: Svc) -> list[CameraInfo]:
    return await svc.cameras.infos()


def _camera(svc: Services, camera_id: str):
    cam = svc.cameras.cameras.get(camera_id)
    if cam is None:
        raise HTTPException(404, "Kamera neexistuje")
    return cam


@router.get("/camera/{camera_id}/snapshot.jpg")
async def snapshot(camera_id: str, svc: Svc, fresh: bool = False) -> Response:
    cam = _camera(svc, camera_id)
    jpeg = None if fresh else svc.pipeline.latest_jpeg(camera_id)
    if jpeg is None:
        jpeg = (await cam.snapshot()).jpeg
    return Response(jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/camera/{camera_id}/live.mjpeg")
async def live_mjpeg(camera_id: str, svc: Svc) -> StreamingResponse:
    """MJPEG náhled. Demo: simulace. Reolink: snímky z hubu (záložní varianta k WebRTC přes go2rtc)."""
    cam = _camera(svc, camera_id)
    demo = svc.demo_world is not None
    interval = 0.5 if demo else 1.5
    limit = svc.settings.live_view_max_seconds

    async def frames():
        started = time.monotonic()
        while time.monotonic() - started < limit:
            try:
                frame = await cam.snapshot()
            except Exception:
                await asyncio.sleep(2)
                continue
            yield (
                b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                + str(len(frame.jpeg)).encode()
                + b"\r\n\r\n"
                + frame.jpeg
                + b"\r\n"
            )
            await asyncio.sleep(interval)

    return StreamingResponse(
        frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/camera/{camera_id}/capture", response_model=Observation | None)
async def capture(camera_id: str, svc: Svc) -> Observation | None:
    _camera(svc, camera_id)
    return await svc.cameras.capture(camera_id, reason="manual")


class TriggerIn(BaseModel):
    camera_id: str
    kind: Literal["motion", "door_open", "door_closed", "manual", "schedule"]


@router.post("/camera/trigger")
async def trigger(body: TriggerIn, svc: Svc) -> dict:
    """Pro externí zdroje (Home Assistant, Reolink webhook, kontakt na dveřích)."""
    _camera(svc, body.camera_id)
    await svc.cameras.handle_trigger(CameraTrigger(camera_id=body.camera_id, kind=body.kind, at=utcnow()))
    return {"ok": True}


class SimulateIn(BaseModel):
    action: Literal["take", "use", "put"]
    item: str
    amount: float = Field(default=0.35, gt=0, le=1)
    expires_in_days: int | None = None


@router.post("/camera/simulate")
async def simulate(body: SimulateIn, svc: Svc) -> dict:
    try:
        return await svc.cameras.simulate(
            body.action, body.item, amount=body.amount, expires_in_days=body.expires_in_days
        )
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/demo/scene")
async def demo_scene(svc: Svc) -> dict:
    """Co je v simulované lednici a co jde přidat (pro ovládání simulace v UI)."""
    from ..food.catalog import CATALOG

    if svc.demo_world is None:
        return {"enabled": False, "in_fridge": [], "can_add": []}
    present = {o.spec.key for objs in svc.demo_world.objects.values() for o in objs}
    return {
        "enabled": True,
        "in_fridge": [
            {
                "key": o.spec.key,
                "name": o.spec.name,
                "emoji": o.spec.emoji,
                "camera_id": cam,
                "fill_level": o.fill_level,
                "quantity": o.quantity,
            }
            for cam, objs in svc.demo_world.objects.items()
            for o in objs
        ],
        "can_add": [
            {"key": s.key, "name": s.name, "emoji": s.emoji} for s in CATALOG if s.key not in present
        ],
    }


_SNAP = re.compile(r"^[A-Za-z0-9_.-]+\.jpg$")


@router.get("/snapshots/{name}")
async def snapshot_file(name: str, svc: Svc) -> FileResponse:
    if not _SNAP.match(name):
        raise HTTPException(400, "Neplatný název")
    path = svc.settings.snapshots_dir / name
    if not path.exists():
        raise HTTPException(404, "Snímek neexistuje")
    return FileResponse(path, media_type="image/jpeg")


@router.get("/observations", response_model=list[Observation])
async def observations(svc: Svc, camera_id: str | None = None, limit: int = 20) -> list[Observation]:
    return svc.pipeline.recent(camera_id, min(limit, 100))


@router.post("/vision/scan")
async def scan_label(
    svc: Svc,
    image: Annotated[UploadFile | None, File()] = None,
    barcode: Annotated[str | None, Form()] = None,
) -> dict:
    """Mobil: vyfoť etiketu (datum spotřeby) nebo pošli EAN z čtečky čárových kódů."""
    result: dict = {"product": None, "canonical": None, "expires_on": None, "barcode": barcode}
    if barcode:
        found = await svc.barcode.lookup(barcode)
        if found:
            result.update(
                {"product": found["name"], "canonical": found["canonical"], "brand": found.get("brand")}
            )
    if image is not None:
        data = await image.read()
        if len(data) > 12 * 1024 * 1024:
            raise HTTPException(413, "Obrázek je moc velký")
        try:
            label = await svc.claude_vision.read_label(data)
        except VisionUnavailable as exc:
            result["note"] = f"{exc}. Datum zadej ručně."
        else:
            result.update({k: v for k, v in label.items() if v is not None})
    return result


# ----------------------------------------------------------------- notifikace a hovory
@router.get("/notifications", response_model=list[Notification])
async def notifications(svc: Svc, limit: int = 50) -> list[Notification]:
    return svc.notify.recent(min(limit, 200))


@router.get("/calls", response_model=list[CallSession])
async def calls(svc: Svc) -> list[CallSession]:
    return svc.voice.recent()


@router.post("/calls", response_model=CallSession)
async def start_call(body: CallRequest, svc: Svc) -> CallSession:
    return await svc.voice.call_user(body.reason, to=body.to)


def _call_or_404(svc: Services, call_id: str) -> CallSession:
    session = svc.voice.get(call_id)
    if session is None:
        raise HTTPException(404, "Hovor neexistuje")
    return session


@router.post("/calls/{call_id}/answer", response_model=CallSession)
async def answer_call(call_id: str, svc: Svc) -> CallSession:
    """Přijetí simulovaného hovoru v prohlížeči. Dál se mluví přes /api/chat s channel=voice."""
    session = _call_or_404(svc, call_id)
    session.status = "in-progress"
    session.direction = "browser"
    svc.voice.save(session)
    svc.voice.add_line(call_id, "assistant", svc.voice.greeting(session.reason))
    return _call_or_404(svc, call_id)


@router.post("/calls/{call_id}/hangup", response_model=CallSession)
async def hangup_call(call_id: str, svc: Svc) -> CallSession:
    _call_or_404(svc, call_id)
    await svc.voice.hangup(call_id, reason="user")
    return _call_or_404(svc, call_id)


# ----------------------------------------------------------------- analytika a nastavení
@router.get("/analytics", response_model=Analytics)
async def analytics(svc: Svc) -> Analytics:
    by_hour = svc.cameras.door_opens_by_hour(svc.tz)
    return Analytics(
        consumption=svc.inventory.consumption_stats(),
        waste_by_month=svc.inventory.waste_by_month(),
        savings_month_czk=savings_month(svc),
        door_opens_today=sum(by_hour),
        door_opens_by_hour=by_hour,
    )


@router.get("/prefs", response_model=UserPreferences)
async def prefs(svc: Svc) -> UserPreferences:
    return svc.prefs.get()


@router.patch("/prefs", response_model=UserPreferences)
async def update_prefs(patch: UserPreferencesUpdate, svc: Svc) -> UserPreferences:
    return svc.prefs.update(patch)


@router.post("/location", response_model=GeoPoint)
async def set_location(point: GeoPoint, svc: Svc) -> GeoPoint:
    """Poloha z prohlížeče (Geolocation API). Adresa se dohledá přes Nominatim (jen v live režimu)."""
    if not point.label:
        point.label = await svc.geo.reverse(point)
    svc.prefs.set_location(point)
    return point
