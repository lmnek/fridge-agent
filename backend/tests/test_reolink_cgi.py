"""HTTP API Reolinku (`/cgi-bin/api.cgi`) proti mocku: přihlášení, snímek, stav pohybu, obnova tokenu."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from frida.camera.reolink import ReolinkCgiClient, ReolinkError

BASE = "https://192.168.1.50/cgi-bin/api.cgi"
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\xff\xd9"


def _ok(value: dict, cmd: str) -> httpx.Response:
    return httpx.Response(200, json=[{"cmd": cmd, "code": 0, "value": value}])


class FakeHub:
    def __init__(self) -> None:
        self.logins = 0
        self.valid_token = "tok-1"
        self.calls: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        cmd = request.url.params.get("cmd")
        self.calls.append(cmd)
        if cmd == "Login":
            body = json.loads(request.content)
            user = body[0]["param"]["User"]
            if user["password"] != "heslo":
                return httpx.Response(
                    200,
                    json=[{"cmd": "Login", "code": 1, "error": {"rspCode": -7, "detail": "login failed"}}],
                )
            self.logins += 1
            self.valid_token = f"tok-{self.logins}"
            return _ok({"Token": {"name": self.valid_token, "leaseTime": 3600}}, "Login")
        if request.url.params.get("token") != self.valid_token:
            return httpx.Response(
                200, json=[{"cmd": cmd, "code": 1, "error": {"rspCode": -6, "detail": "please login first"}}]
            )
        if cmd == "Snap":
            assert request.url.params.get("channel") == "1"
            return httpx.Response(200, content=JPEG, headers={"content-type": "image/jpeg"})
        if cmd == "GetMdState":
            channel = json.loads(request.content)[0]["param"]["channel"]
            return _ok({"state": 1 if channel == 0 else 0}, cmd)
        if cmd == "GetChannelstatus":
            return _ok(
                {"count": 2, "status": [{"channel": 0, "online": 1}, {"channel": 1, "online": 1}]}, cmd
            )
        if cmd == "Logout":
            return _ok({}, cmd)
        return httpx.Response(404)


@pytest.fixture
def hub():
    fake = FakeHub()
    with respx.mock(assert_all_called=False) as router:
        router.route(url__startswith=BASE).mock(side_effect=fake)
        yield fake


async def test_login_snapshot_and_motion(hub):
    client = ReolinkCgiClient("192.168.1.50", "frida", "heslo")
    try:
        assert await client.snapshot(1) == JPEG
        assert await client.motion_state(0) is True
        assert await client.motion_state(1) is False
        status = await client.channel_status()
        assert [s["channel"] for s in status] == [0, 1]
        assert hub.logins == 1, "token se má znovu použít"
    finally:
        await client.close()
    assert hub.calls[-1] == "Logout"


async def test_token_refresh_after_hub_drops_session(hub):
    client = ReolinkCgiClient("192.168.1.50", "frida", "heslo")
    try:
        await client.motion_state(0)
        hub.valid_token = "zahozeno"  # hub zahodil relaci (limit relací, restart)
        assert await client.motion_state(0) is True
        assert hub.logins == 2
    finally:
        await client.close()


async def test_bad_password(hub):
    client = ReolinkCgiClient("192.168.1.50", "frida", "spatne")
    try:
        with pytest.raises(ReolinkError, match="Login"):
            await client.snapshot(0)
    finally:
        await client.close()
