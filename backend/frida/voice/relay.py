"""WebSocket pro Twilio ConversationRelay: telefonní hovor s Fridou.

Twilio dělá převod řeči na text (Deepgram, cs-CZ) a zpět (ElevenLabs), my jen
dostáváme text a posíláme text po kouscích (tokeny), takže Frida začne mluvit
dřív, než dopíše celou větu.

Zprávy od Twilia: `setup`, `prompt` (`voicePrompt`, `last`), `interrupt`, `dtmf`, `error`.
Zprávy od nás: `{"type": "text", "token", "last"}` a `{"type": "end", "handoffData"}`.

Pojistky: podpis `X-Twilio-Signature` při připojení, hovor se ukončí nástrojem
`zavesit` nebo watchdogem po `FRIDA_CALL_MAX_SECONDS`.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import TYPE_CHECKING, Any

from fastapi import WebSocket, WebSocketDisconnect

from ..schemas import ChatRequest
from .twiml import relay_ws_url

if TYPE_CHECKING:
    from ..services import Services

log = logging.getLogger(__name__)

DTMF_TEXT = {"1": "Ano.", "2": "Ne.", "0": "Na shledanou."}


class RelaySession:
    def __init__(self, ws: WebSocket, svc: Services) -> None:
        self.ws = ws
        self.svc = svc
        self.session_id: str | None = None
        self.reason = ""
        self.conversation_id: str | None = None
        self.task: asyncio.Task | None = None
        self.closed = False

    async def send(self, msg: dict[str, Any]) -> None:
        if not self.closed:
            await self.ws.send_text(json.dumps(msg, ensure_ascii=False))

    async def run(self) -> None:
        try:
            while True:
                raw = await self.ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                await self.handle(msg)
        except WebSocketDisconnect:
            pass
        finally:
            self.closed = True
            if self.task:
                self.task.cancel()
            if self.session_id:
                self.svc.voice.finish(self.session_id)

    async def handle(self, msg: dict[str, Any]) -> None:
        kind = msg.get("type")
        if kind == "setup":
            params = msg.get("customParameters") or {}
            self.session_id = params.get("frida_session")
            self.reason = params.get("reason") or ""
            session = self.svc.voice.get(self.session_id) if self.session_id else None
            if session is None:
                session = self.svc.voice.by_sid(msg.get("callSid", ""))
                self.session_id = session.id if session else None
            if session:
                session.status = "in-progress"
                self.svc.voice.save(session)
                self.svc.voice.add_line(session.id, "assistant", self.svc.voice.greeting(session.reason))
                self.reason = session.reason
        elif kind == "prompt":
            text = (msg.get("voicePrompt") or "").strip()
            if text and msg.get("last", True):
                self.start_turn(text)
        elif kind == "dtmf":
            text = DTMF_TEXT.get(str(msg.get("digit")))
            if text:
                self.start_turn(text)
        elif kind == "interrupt":
            # Uživatel skočil Fridě do řeči: rozpracovanou odpověď zahodíme (do historie se neuloží).
            if self.task and not self.task.done():
                self.task.cancel()
        elif kind == "error":
            log.warning("ConversationRelay error: %s", msg.get("description"))

    def start_turn(self, text: str) -> None:
        if self.task and not self.task.done():
            self.task.cancel()
        self.task = asyncio.create_task(self.turn(text))

    async def turn(self, text: str) -> None:
        if self.session_id:
            self.svc.voice.add_line(self.session_id, "user", text)

        async def token(t: str) -> None:
            await self.send({"type": "text", "token": t, "last": False})

        reply = await self.svc.agent.respond(
            ChatRequest(text=text, conversation_id=self.conversation_id, channel="voice"),
            on_delta=token,
            extra_context=f"- právě telefonuješ s uživatelem, důvod hovoru: {self.reason}"
            if self.reason
            else None,
            call_session_id=self.session_id,
        )
        self.conversation_id = reply.conversation_id
        await self.send({"type": "text", "token": "", "last": True})
        if self.session_id:
            self.svc.voice.add_line(self.session_id, "assistant", reply.message.text)
        if reply.hangup:
            await asyncio.sleep(0.2)
            await self.send(
                {"type": "end", "handoffData": json.dumps({"reason": reply.hangup_reason or "konec"})}
            )


async def handle_relay(ws: WebSocket, svc: Services) -> None:
    signature = ws.headers.get("x-twilio-signature")
    if not svc.voice.validate_signature(relay_ws_url(svc.settings), {}, signature):
        await ws.close(code=1008)
        return
    await ws.accept()
    session = RelaySession(ws, svc)
    with contextlib.suppress(Exception):
        await session.run()
