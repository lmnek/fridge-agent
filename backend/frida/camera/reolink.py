"""Reolink Home Hub + bateriové kamery Argus (B310).

Dvě cesty k hubu:
1. `reolink_aio` (doporučeno, `uv sync --extra reolink`): přihlášení, snímky
   s fallbackem přes Baichuan protokol a hlavně **TCP push událostí** (port 9000),
   takže Frida ví o pohybu hned a nemusí se ptát.
2. Čisté HTTP API (`/cgi-bin/api.cgi`) přes httpx: Login token, Snap,
   GetChannelstatus a dotazování GetMdState, které kameru neprobouzí.

Důležité (docs/integrace/reolink-kamera.md):
- Hub musí být v aplikaci přidaný jako "Local device".
- Každý snímek kameru probudí (10 až 30 s). Proto se fotí jen při události.
- Kanály jsou číslované od 0, RTSP cesta používá kanál + 1.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime

import httpx

from ..config import Settings
from ..db import utcnow
from ..schemas import CameraInfo, LiveStreamInfo
from .base import CameraTrigger, Frame

log = logging.getLogger(__name__)


class ReolinkError(RuntimeError):
    pass


class ReolinkCgiClient:
    """Minimální klient HTTP API Reolinku (bez závislosti na reolink_aio)."""

    def __init__(self, host: str, username: str, password: str, *, https: bool = True, timeout: float = 40) -> None:
        scheme = "https" if https else "http"
        self.base = f"{scheme}://{host}/cgi-bin/api.cgi"
        self.username = username
        self.password = password
        # Hub má self-signed certifikát a běží v LAN, proto bez ověření certifikátu.
        self.http = httpx.AsyncClient(timeout=timeout, verify=False)
        self._token: str | None = None
        self._token_until = 0.0
        self._lock = asyncio.Lock()

    async def _login(self) -> str:
        body = [{"cmd": "Login", "action": 0, "param": {"User": {"userName": self.username, "password": self.password}}}]
        r = await self.http.post(self.base, params={"cmd": "Login"}, json=body)
        r.raise_for_status()
        data = r.json()[0]
        if data.get("code") != 0:
            raise ReolinkError(f"Login selhal: {json.dumps(data.get('error'), ensure_ascii=False)}")
        token = data["value"]["Token"]
        self._token = token["name"]
        self._token_until = time.monotonic() + int(token.get("leaseTime", 3600)) - 60
        return self._token

    async def token(self) -> str:
        async with self._lock:
            if self._token is None or time.monotonic() > self._token_until:
                return await self._login()
            return self._token

    async def command(self, cmd: str, param: dict | None = None, *, action: int = 0) -> dict:
        tok = await self.token()
        body = [{"cmd": cmd, "action": action, "param": param or {}}]
        r = await self.http.post(self.base, params={"cmd": cmd, "token": tok}, json=body)
        r.raise_for_status()
        data = r.json()[0]
        if data.get("code") != 0:
            # Token mohl vypršet nebo ho hub zahodil (limit relací) - jeden pokus znovu.
            self._token = None
            tok = await self.token()
            r = await self.http.post(self.base, params={"cmd": cmd, "token": tok}, json=body)
            data = r.json()[0]
            if data.get("code") != 0:
                raise ReolinkError(f"{cmd} selhal: {data.get('error')}")
        return data.get("value", {})

    async def snapshot(self, channel: int, *, sub: bool = False) -> bytes:
        tok = await self.token()
        params = {"cmd": "Snap", "channel": channel, "rs": secrets.token_hex(6), "token": tok}
        if sub:
            params["snapType"] = "sub"
        r = await self.http.get(self.base, params=params)
        r.raise_for_status()
        if not r.headers.get("content-type", "").startswith("image"):
            raise ReolinkError(f"Snap nevrátil obrázek: {r.text[:200]}")
        return r.content

    async def channel_status(self) -> list[dict]:
        value = await self.command("GetChannelstatus")
        return value.get("status", [])

    async def motion_state(self, channel: int) -> bool:
        value = await self.command("GetMdState", {"channel": channel})
        return bool(value.get("state"))

    async def close(self) -> None:
        if self._token:
            try:
                await self.command("Logout")
            except Exception:  # noqa: BLE001
                pass
        await self.http.aclose()


class ReolinkHub:
    """Spojení na Home Hub. Použije reolink_aio, když je nainstalované."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        assert settings.reolink_password is not None
        self.password = settings.reolink_password.get_secret_value()
        self._host = None  # reolink_aio.api.Host
        self._cgi: ReolinkCgiClient | None = None
        self._callbacks: list[Callable[[int, bool], None]] = []
        self._motion: dict[int, bool] = {}

    async def connect(self) -> None:
        try:
            from reolink_aio.api import Host  # type: ignore[import-not-found]
        except ImportError:
            Host = None  # noqa: N806
        if Host is not None:
            host = Host(
                self.settings.reolink_host,
                self.settings.reolink_username,
                self.password,
                use_https=self.settings.reolink_use_https,
            )
            await host.get_host_data()
            self._host = host
            log.info("reolink: připojeno přes reolink_aio, kanály %s", list(host.stream_channels))
        else:
            self._cgi = ReolinkCgiClient(
                self.settings.reolink_host,
                self.settings.reolink_username,
                self.password,
                https=self.settings.reolink_use_https,
            )
            status = await self._cgi.channel_status()
            log.info("reolink: připojeno přes HTTP API, kanály %s", status)

    @property
    def uses_push(self) -> bool:
        return self._host is not None

    async def snapshot(self, channel: int) -> bytes:
        if self._host is not None:
            data = await self._host.get_snapshot(channel, "main")
            if not data:
                raise ReolinkError(f"Kanál {channel}: snímek se nepodařilo získat (kamera spí nebo je mimo dosah)")
            return data
        assert self._cgi is not None
        return await self._cgi.snapshot(channel)

    def battery(self, channel: int) -> int | None:
        return self._host.battery_percentage(channel) if self._host is not None else None

    def wifi(self, channel: int) -> int | None:
        return self._host.wifi_signal(channel) if self._host is not None else None

    def online(self, channel: int) -> bool:
        return self._host.camera_online(channel) if self._host is not None else True

    async def events(self, channels: list[int]) -> AsyncIterator[CameraTrigger]:
        """Nekonečný proud spouštěčů (pohyb začal/skončil)."""
        queue: asyncio.Queue[CameraTrigger] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        if self._host is not None:
            host = self._host

            def on_push() -> None:
                # Volá se při každé změně stavu pohybu/AI na libovolném kanálu (začátek i konec).
                for ch in channels:
                    now_moving = host.motion_detected(ch)
                    if now_moving != self._motion.get(ch, False):
                        self._motion[ch] = now_moving
                        kind = "door_open" if now_moving else "door_closed"
                        loop.call_soon_threadsafe(
                            queue.put_nowait, CameraTrigger(f"cam{ch}", kind, utcnow(), {"source": "reolink-push"})
                        )

            host.baichuan.register_callback("frida", on_push, cmd_id=33)
            await host.baichuan.subscribe_events()
            try:
                while True:
                    yield await queue.get()
            finally:
                await host.baichuan.unsubscribe_events()
        else:
            assert self._cgi is not None
            while True:
                for ch in channels:
                    try:
                        moving = await self._cgi.motion_state(ch)
                    except Exception as exc:  # noqa: BLE001
                        log.debug("reolink poll ch%s: %s", ch, exc)
                        continue
                    if moving != self._motion.get(ch, False):
                        self._motion[ch] = moving
                        yield CameraTrigger(
                            f"cam{ch}", "door_open" if moving else "door_closed", utcnow(), {"source": "reolink-poll"}
                        )
                await asyncio.sleep(self.settings.reolink_poll_seconds)

    async def close(self) -> None:
        if self._host is not None:
            await self._host.logout()
        if self._cgi is not None:
            await self._cgi.close()


class ReolinkCamera:
    def __init__(self, hub: ReolinkHub, settings: Settings, camera_id: str, name: str, channel: int) -> None:
        self.hub = hub
        self.settings = settings
        self.id = camera_id
        self.name = name
        self.channel = channel
        self.last_snapshot_at: datetime | None = None

    async def snapshot(self) -> Frame:
        from io import BytesIO

        from PIL import Image

        jpeg = await self.hub.snapshot(self.channel)
        with Image.open(BytesIO(jpeg)) as img:
            width, height = img.size
        self.last_snapshot_at = datetime.now(UTC)
        return Frame(camera_id=self.id, jpeg=jpeg, taken_at=self.last_snapshot_at, width=width, height=height)

    async def info(self) -> CameraInfo:
        return CameraInfo(
            id=self.id,
            name=self.name,
            channel=self.channel,
            mode="live",
            online=self.hub.online(self.channel),
            battery_pct=self.hub.battery(self.channel),
            wifi_signal=self.hub.wifi(self.channel),
            last_snapshot_at=self.last_snapshot_at,
            snapshot_url=f"/api/camera/{self.id}/snapshot.jpg",
            live=self.live_stream(),
        )

    def live_stream(self) -> LiveStreamInfo | None:
        base = (self.settings.go2rtc_public_url or self.settings.go2rtc_url).rstrip("/")
        return LiveStreamInfo(
            kind="webrtc",
            url=f"{base}/stream.html?src=fridge_cam{self.channel}&mode=webrtc,mse",
            note=f"Bateriová kamera: náhled max. {self.settings.live_view_max_seconds} s, pak usne.",
        )
