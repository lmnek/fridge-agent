"""Beat F: Coldex phones the real Rohlík courier, and the stage hears both sides.

Twilio calls the courier and streams the call (mu-law, 8 kHz) to /courier/media over a WebSocket. The bridge
relays it to an OpenAI Realtime session that speaks the same mu-law, so nothing is transcoded, and fans both
sides out to /courier/listen, where the stage plays them. Captions for both sides and the call phases go on
the bus. The prompt is memory/courier.md.

    POST /courier/call      the stage hotkey. Calls COURIER_NUMBER and nobody else.
    POST /courier/hangup
    POST /courier/fake      HACK(demo): a scripted call through the same events, no phone involved
    POST /courier/status    Twilio's status webhook
    WS   /courier/media     Twilio Media Streams
    WS   /courier/listen    the stage: {"who": "courier" | "coldex", "audio": base64 mu-law 8 kHz}

Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, COURIER_NUMBER and PUBLIC_URL, the tunnel address
that reaches the bridge (https://<tunnel>/api when the tunnel points at the app on 5174).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import ssl
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from xml.sax.saxutils import quoteattr

import certifi
import httpx
import websockets
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM = os.getenv("TWILIO_FROM", "")
COURIER_NUMBER = os.getenv("COURIER_NUMBER", "")
PUBLIC_URL = os.getenv("PUBLIC_URL", "").rstrip("/")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
REALTIME_MODEL = os.getenv("REALTIME_MODEL", "gpt-realtime-2.1")
REALTIME_VOICE = os.getenv("REALTIME_VOICE", "marin")
TRANSCRIBE_MODEL = os.getenv("TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
MAX_SECONDS = int(os.getenv("COURIER_MAX_SECONDS", "90"))
STREAM_KEY = secrets.token_urlsafe(16)  # only a stream that carries it gets a Realtime session on our key
TWILIO_API = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}"

router = APIRouter(prefix="/courier")
_listeners: set[WebSocket] = set()
_call: dict[str, Any] = {}


class _Hooks:
    emit: Callable[..., None] = staticmethod(lambda kind, **data: None)


hooks = _Hooks()


def attach(emit: Callable[..., None]) -> None:
    hooks.emit = emit


def missing() -> list[str]:
    needed = {
        "TWILIO_ACCOUNT_SID": TWILIO_SID,
        "TWILIO_AUTH_TOKEN": TWILIO_TOKEN,
        "TWILIO_FROM": TWILIO_FROM,
        "COURIER_NUMBER": COURIER_NUMBER,
        "PUBLIC_URL": PUBLIC_URL,
        "OPENAI_API_KEY": OPENAI_API_KEY,
    }
    return [name for name, value in needed.items() if not value]


def mask(number: str) -> str:
    return f"{number[:4]} *** *** {number[-3:]}" if len(number) > 7 else "***"


def twiml() -> str:
    url = PUBLIC_URL.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/courier/media"
    return (
        f"<Response><Connect><Stream url={quoteattr(url)}>"
        f'<Parameter name="key" value={quoteattr(STREAM_KEY)}/>'
        "</Stream></Connect></Response>"
    )


def session() -> dict[str, Any]:
    return {
        "type": "realtime",
        "instructions": (ROOT / "memory" / "courier.md").read_text(),
        "audio": {
            "input": {
                "format": {"type": "audio/pcmu"},
                "transcription": {"model": TRANSCRIBE_MODEL},
                # A short call with a script: the courier talking over Coldex must not cut the line off.
                "turn_detection": {"type": "server_vad", "interrupt_response": False, "silence_duration_ms": 500},
            },
            "output": {"format": {"type": "audio/pcmu"}, "voice": REALTIME_VOICE},
        },
        "tools": [
            {
                "type": "function",
                "name": "end_call",
                "description": "Hang up. Call it right after you said goodbye.",
                "parameters": {"type": "object", "properties": {}},
            }
        ],
        "tool_choice": "auto",
    }


# --------------------------------------------------------------------------- the call


@router.post("/call")
async def call() -> dict[str, Any]:
    if gaps := missing():
        raise HTTPException(503, f"Courier call is not set up, missing in bridge/.env: {', '.join(gaps)}.")
    if _call.get("sid") and not _call.get("ended"):
        raise HTTPException(409, "A courier call is already running.")
    hooks.emit("call", phase="dialing", number=mask(COURIER_NUMBER))
    async with httpx.AsyncClient(auth=(TWILIO_SID, TWILIO_TOKEN), timeout=20) as client:
        res = await client.post(
            f"{TWILIO_API}/Calls.json",
            data={
                "To": COURIER_NUMBER,
                "From": TWILIO_FROM,
                "Twiml": twiml(),
                "StatusCallback": f"{PUBLIC_URL}/courier/status",
                "StatusCallbackEvent": ["initiated", "ringing", "answered", "completed"],
                "TimeLimit": str(MAX_SECONDS),
            },
        )
    if res.status_code >= 400:
        hooks.emit("call", phase="ended", number=mask(COURIER_NUMBER), error=res.text[:200])
        raise HTTPException(502, f"Twilio: {res.text[:300]}")
    _call.clear()
    _call.update(sid=res.json()["sid"], started=time.time(), ended=False)
    return {"ok": True, "number": mask(COURIER_NUMBER)}


async def _hangup(sid: str | None) -> None:
    if not sid or not TWILIO_SID:
        return
    async with httpx.AsyncClient(auth=(TWILIO_SID, TWILIO_TOKEN), timeout=10) as client:
        await client.post(f"{TWILIO_API}/Calls/{sid}.json", data={"Status": "completed"})


@router.post("/hangup")
async def hangup() -> dict[str, Any]:
    """Also the reset: a rehearsal call whose status webhook never arrived must not block the next call."""
    try:
        await _hangup(_call.get("sid"))
    finally:
        _call["ended"] = True
    return {"ok": True}


PHASES = {
    "ringing": "ringing",
    "in-progress": "answered",
    "completed": "ended",
    "busy": "ended",
    "no-answer": "ended",
    "failed": "ended",
    "canceled": "ended",
}


def signed(signature: str, url: str, form: dict[str, str]) -> bool:
    """Twilio's X-Twilio-Signature: HMAC-SHA1 of the URL plus the sorted form fields, keyed by the auth token."""
    data = url + "".join(k + form[k] for k in sorted(form))
    expected = base64.b64encode(hmac.new(TWILIO_TOKEN.encode(), data.encode(), hashlib.sha1).digest()).decode()
    return bool(TWILIO_TOKEN) and hmac.compare_digest(signature, expected)


@router.post("/status")
async def status(request: Request) -> Response:
    form = {k: str(v) for k, v in (await request.form()).items()}
    if not signed(request.headers.get("X-Twilio-Signature", ""), f"{PUBLIC_URL}/courier/status", form):
        raise HTTPException(403, "Bad Twilio signature.")
    phase = PHASES.get(form.get("CallStatus", ""))
    if phase:
        hooks.emit("call", phase=phase, number=mask(COURIER_NUMBER), status=form["CallStatus"])
    if phase == "ended":
        _call["ended"] = True
    return Response(status_code=204)


# --------------------------------------------------------------------------- audio relay


async def _fan_out(who: str, payload: str) -> None:
    message = json.dumps({"who": who, "audio": payload})
    for ws in list(_listeners):
        try:
            await ws.send_text(message)
        except Exception:
            _listeners.discard(ws)


@router.websocket("/listen")
async def listen(ws: WebSocket) -> None:
    await ws.accept()
    _listeners.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _listeners.discard(ws)


class Relay:
    """One phone call: Twilio's stream on one side, a Realtime session on the other."""

    def __init__(self, twilio: WebSocket, stream_sid: str, call_sid: str | None) -> None:
        self.twilio = twilio
        self.stream_sid = stream_sid
        self.call_sid = call_sid
        self.captions: dict[str, str] = {}
        self.courier_spoke = asyncio.Event()

    def caption(self, who: str, item: str, text: str, final: bool) -> None:
        hooks.emit("caption", who=who, id=item, text=text, final=final)

    async def from_twilio(self, oai: Any) -> None:
        while True:
            msg = json.loads(await self.twilio.receive_text())
            if msg["event"] == "media":
                payload = msg["media"]["payload"]
                await oai.send(json.dumps({"type": "input_audio_buffer.append", "audio": payload}))
                await _fan_out("courier", payload)
            elif msg["event"] == "mark" and msg["mark"].get("name") == "bye":
                await _hangup(self.call_sid)  # Coldex's goodbye has finished playing on the phone
            elif msg["event"] == "stop":
                _call["ended"] = True
                return

    async def from_openai(self, oai: Any) -> None:
        async for raw in oai:
            ev = json.loads(raw)
            kind = ev["type"]
            if kind == "response.output_audio.delta":
                media = {"event": "media", "streamSid": self.stream_sid, "media": {"payload": ev["delta"]}}
                await self.twilio.send_text(json.dumps(media))
                await _fan_out("coldex", ev["delta"])
            elif kind == "response.output_audio_transcript.delta":
                text = self.captions.get(ev["item_id"], "") + ev["delta"]
                self.captions[ev["item_id"]] = text
                self.caption("coldex", ev["item_id"], text, False)
            elif kind == "response.output_audio_transcript.done":
                self.caption("coldex", ev["item_id"], ev.get("transcript", ""), True)
            elif kind == "input_audio_buffer.speech_started":
                self.courier_spoke.set()
            elif kind == "conversation.item.input_audio_transcription.delta":
                text = self.captions.get(ev["item_id"], "") + ev.get("delta", "")
                self.captions[ev["item_id"]] = text
                self.caption("courier", ev["item_id"], text, False)
            elif kind == "conversation.item.input_audio_transcription.completed":
                self.caption("courier", ev["item_id"], ev.get("transcript", ""), True)
            elif kind == "response.done":
                output = ev["response"].get("output", [])
                if any(o.get("type") == "function_call" and o.get("name") == "end_call" for o in output):
                    mark = {"event": "mark", "streamSid": self.stream_sid, "mark": {"name": "bye"}}
                    await self.twilio.send_text(json.dumps(mark))
            elif kind == "error":
                hooks.emit("system", message=f"Courier call: {ev['error'].get('message')}")

    async def greet(self, oai: Any) -> None:
        """HACK(demo): the story is the courier calling in, so Coldex answers first, like whoever picks up."""
        await asyncio.sleep(0.4)
        if not self.courier_spoke.is_set():
            await oai.send(json.dumps({"type": "response.create"}))


@router.websocket("/media")
async def media(ws: WebSocket) -> None:
    await ws.accept()
    start: dict[str, Any] = {}
    while not start:
        msg = json.loads(await ws.receive_text())
        if msg["event"] == "start":
            start = msg["start"]
    if start.get("customParameters", {}).get("key") != STREAM_KEY:
        await ws.close(code=1008)
        return
    relay = Relay(ws, start["streamSid"], start.get("callSid"))
    async with websockets.connect(
        f"wss://api.openai.com/v1/realtime?model={REALTIME_MODEL}",
        additional_headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        ssl=ssl.create_default_context(cafile=certifi.where()),
        max_size=None,
    ) as oai:
        await oai.send(json.dumps({"type": "session.update", "session": session()}))
        tasks = [asyncio.create_task(t) for t in (relay.from_twilio(oai), relay.from_openai(oai), relay.greet(oai))]
        try:
            await asyncio.wait(tasks[:2], return_when=asyncio.FIRST_COMPLETED)
        except WebSocketDisconnect:
            pass
        finally:
            for task in tasks:
                task.cancel()


# --------------------------------------------------------------------------- fake mode

SCRIPT = [
    (0.0, "call", {"phase": "dialing"}),
    (1.5, "call", {"phase": "ringing"}),
    (4.0, "call", {"phase": "answered"}),
    (4.4, "coldex", "Hi, Coldex here, Kryštof's fridge."),
    (7.0, "courier", "Hi, it's the Rohlík courier. I'm at the building with the order, where do I go?"),
    (11.5, "coldex", "Thanks for calling. Skip the door and come straight onto the stage, we're waiting for you."),
    (17.0, "courier", "Onto the stage? Okay, I'm coming in now."),
    (19.5, "coldex", "Perfect, see you in a minute."),
    (22.5, "call", {"phase": "ended"}),
]


@router.post("/fake")
async def fake() -> dict[str, Any]:
    """HACK(demo): the F card without a phone. Same call and caption events, words appear as if spoken."""

    async def play() -> None:
        t0 = time.monotonic()
        for n, (at, who, what) in enumerate(SCRIPT):
            await asyncio.sleep(max(0.0, at - (time.monotonic() - t0)))
            if who == "call":
                hooks.emit("call", number=mask(COURIER_NUMBER or "+420000000000"), fake=True, **what)
                continue
            words = what.split()
            for i in range(1, len(words) + 1):
                hooks.emit("caption", who=who, id=f"fake-{n}", text=" ".join(words[:i]), final=i == len(words))
                await asyncio.sleep(0.28)

    asyncio.create_task(play())
    return {"ok": True}
