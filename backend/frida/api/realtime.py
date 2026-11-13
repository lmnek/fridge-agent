"""Živé věci: WebSocket událostí, chat s agentem, webhooky a hlasový most Twilia."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from .. import __version__
from ..db import utcnow
from ..schemas import ChatMessage, ChatRequest
from ..services import Services
from ..voice.relay import handle_relay
from .deps import get_svc, ws_svc

log = logging.getLogger(__name__)
router = APIRouter()
Svc = Annotated[Services, Depends(get_svc)]


# ----------------------------------------------------------------- WebSocket událostí
@router.websocket("/ws")
async def events_ws(ws: WebSocket) -> None:
    svc = ws_svc(ws)
    await ws.accept()

    async def send(type_: str, payload: dict) -> None:
        envelope = {"type": type_, "ts": utcnow().isoformat(), "payload": payload}
        await ws.send_text(json.dumps(envelope, ensure_ascii=False, default=str))

    async with svc.bus.subscribe() as queue:
        await send(
            "hello",
            {
                "version": __version__,
                "integrations": svc.integration_modes(),
                "agent": svc.agent.mode,
                "door": svc.cameras.door_open,
            },
        )
        await send(
            "inventory",
            {
                "items": [i.model_dump(mode="json") for i in svc.inventory.list()],
                "summary": svc.inventory.summary().model_dump(mode="json"),
            },
        )

        async def pump() -> None:
            while True:
                env = await queue.get()
                await ws.send_text(env.model_dump_json())

        pump_task = asyncio.create_task(pump())
        try:
            while True:
                raw = await ws.receive_text()
                with contextlib.suppress(json.JSONDecodeError, AttributeError):
                    if json.loads(raw).get("type") == "ping":
                        await send("pong", {})
        except WebSocketDisconnect:
            pass
        finally:
            pump_task.cancel()
            with contextlib.suppress(BaseException):
                await pump_task


# ----------------------------------------------------------------- chat
@router.post("/api/chat")
async def chat(req: ChatRequest, svc: Svc) -> dict:
    """Odpověď se zároveň streamuje přes /ws (agent.start, agent.delta, agent.tool, agent.done)."""
    extra = None
    if req.call_session_id:
        session = svc.voice.get(req.call_session_id)
        if session is None:
            raise HTTPException(404, "Hovor neexistuje")
        extra = f"- právě spolu mluvíte hlasem (hovor v aplikaci), důvod hovoru: {session.reason}"
        svc.voice.add_line(session.id, "user", req.text)
    reply = await svc.agent.respond(req, extra_context=extra, call_session_id=req.call_session_id)
    if req.call_session_id:
        svc.voice.add_line(req.call_session_id, "assistant", reply.message.text)
        if reply.hangup:
            await svc.voice.hangup(req.call_session_id, reason="agent")
    return {
        "conversation_id": reply.conversation_id,
        "message": reply.message.model_dump(mode="json"),
        "hangup": reply.hangup,
    }


@router.get("/api/chat/{conversation_id}", response_model=list[ChatMessage])
async def chat_history(conversation_id: str, svc: Svc) -> list[ChatMessage]:
    return svc.agent.history(conversation_id)


@router.get("/api/conversations")
async def conversations(svc: Svc) -> list[dict]:
    return svc.agent.conversations()


# ----------------------------------------------------------------- Twilio
async def _twilio_form(request: Request, svc: Services) -> dict[str, str]:
    form = {k: str(v) for k, v in (await request.form()).items()}
    url = svc.settings.public_base_url.rstrip("/") + request.url.path
    if not svc.voice.validate_signature(url, form, request.headers.get("x-twilio-signature")):
        raise HTTPException(403, "Neplatný podpis Twilia")
    return form


@router.post("/voice/status")
async def voice_status(request: Request, svc: Svc) -> Response:
    form = await _twilio_form(request, svc)
    svc.voice.on_status(form.get("CallSid", ""), form.get("CallStatus", ""))
    return Response(status_code=204)


@router.post("/voice/amd")
async def voice_amd(request: Request, svc: Svc) -> Response:
    form = await _twilio_form(request, svc)
    await svc.voice.on_amd(form.get("CallSid", ""), form.get("AnsweredBy", "unknown"))
    return Response(status_code=204)


@router.post("/voice/relay-ended")
async def relay_ended(request: Request, svc: Svc) -> Response:
    form = await _twilio_form(request, svc)
    session = svc.voice.by_sid(form.get("CallSid", ""))
    if session:
        svc.voice.finish(session.id)
    return Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', media_type="text/xml"
    )


@router.websocket("/voice/relay")
async def voice_relay(ws: WebSocket) -> None:
    await handle_relay(ws, ws_svc(ws))
