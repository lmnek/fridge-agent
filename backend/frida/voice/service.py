"""Hovory a zprávy přes Twilio (nebo jejich simulace v demo režimu).

Bez Twilio klíčů se hovor "simuluje": UI dostane zprávu `call` se stavem
`simulated` a ukáže příchozí hovor od Fridy, který jde přijmout v prohlížeči
(hlasový režim na stejném agentovi). Nic se nikam nevolá.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from datetime import datetime

from ..bus import EventBus
from ..config import Settings
from ..db import DocStore, utcnow
from ..events import EventLog
from ..schemas import CallSession, TranscriptLine
from .policy import CallPolicy, mask_phone, normalize_phone
from .twiml import conversation_relay_twiml

log = logging.getLogger(__name__)

CALLS = "calls"


class VoiceService:
    def __init__(self, settings: Settings, store: DocStore, bus: EventBus, events: EventLog) -> None:
        self.settings = settings
        self.store = store
        self.bus = bus
        self.events = events
        self.policy = CallPolicy(settings)
        self._client = None
        self._watchdogs: dict[str, asyncio.Task] = {}

    @property
    def live(self) -> bool:
        return self.settings.has_twilio

    def _twilio(self):
        if self._client is None:
            from twilio.rest import Client

            assert self.settings.twilio_auth_token is not None
            self._client = Client(self.settings.twilio_account_sid, self.settings.twilio_auth_token.get_secret_value())
        return self._client

    # ------------------------------------------------------------- relace
    def get(self, session_id: str) -> CallSession | None:
        return self.store.get(CALLS, session_id, CallSession)

    def by_sid(self, call_sid: str) -> CallSession | None:
        for raw in self.store.list_raw(CALLS, limit=50):
            if raw.get("twilio_sid") == call_sid:
                return CallSession.model_validate(raw)
        return None

    def save(self, session: CallSession) -> CallSession:
        self.store.put(CALLS, session.id, session, ts=session.started_at)
        self.bus.publish("call", session)
        return session

    def recent(self, limit: int = 20) -> list[CallSession]:
        return self.store.list(CALLS, CallSession, limit=limit)

    def add_line(self, session_id: str, role: str, text: str) -> None:
        session = self.get(session_id)
        if session is None or not text.strip():
            return
        session.transcript.append(TranscriptLine(role=role, text=text.strip(), ts=utcnow()))  # type: ignore[arg-type]
        self.save(session)

    def finish(self, session_id: str, status: str = "completed") -> None:
        session = self.get(session_id)
        if session is None or session.ended_at is not None:
            return
        session.status = status  # type: ignore[assignment]
        session.ended_at = utcnow()
        self.save(session)
        task = self._watchdogs.pop(session_id, None)
        if task:
            task.cancel()
        secs = int((session.ended_at - session.started_at).total_seconds())
        self.events.emit("call_ended", "Hovor s Fridou skončil", detail=f"Délka {secs} s", data={"session_id": session_id})

    # ------------------------------------------------------------- hovory
    def greeting(self, reason: str) -> str:
        return f"Ahoj, tady Frida, tvoje lednice. {reason} Chceš, abych s tím něco udělala?"

    async def call_user(self, reason: str, *, to: str | None = None, urgent: bool = False) -> CallSession:
        number = normalize_phone(to or self.settings.user_phone)
        session = CallSession(
            id=f"call_{uuid.uuid4().hex[:10]}",
            direction="outbound",
            to_masked=mask_phone(number) if number else None,
            started_at=utcnow(),
            status="queued",
            reason=reason,
        )
        if not self.live:
            session.status = "simulated"
            self.save(session)
            self.events.emit(
                "call_started",
                "Frida ti volá (simulace)",
                detail=f"{reason} V demo režimu hovor přijmeš přímo v aplikaci.",
                severity="info",
                data={"session_id": session.id, "simulated": True},
            )
            return session

        decision = self.policy.check(number, urgent=urgent)
        if not decision.allowed:
            session.status = "refused"
            session.ended_at = utcnow()
            self.save(session)
            self.events.emit("system", "Hovor neproběhl", detail=decision.reason, severity="warning",
                             data={"session_id": session.id})
            return session

        twiml = conversation_relay_twiml(
            self.settings, greeting=self.greeting(reason), session_id=session.id, reason=reason
        )
        base = self.settings.public_base_url.rstrip("/")
        kwargs: dict = {
            "to": number,
            "from_": self.settings.twilio_from_number,
            "twiml": twiml,
            "status_callback": f"{base}/voice/status",
            "status_callback_event": ["initiated", "ringing", "answered", "completed"],
            "time_limit": self.settings.call_max_seconds + 30,
        }
        if self.settings.voice_machine_detection:
            kwargs.update(
                machine_detection="Enable", async_amd=True, async_amd_status_callback=f"{base}/voice/amd"
            )
        try:
            call = await asyncio.to_thread(self._twilio().calls.create, **kwargs)
        except Exception as exc:  # noqa: BLE001
            log.exception("twilio call failed")
            session.status = "failed"
            session.ended_at = utcnow()
            self.save(session)
            self.events.emit("system", "Twilio hovor selhal", detail=str(exc)[:300], severity="critical")
            return session
        self.policy.record_start()
        session.twilio_sid = call.sid
        session.status = "ringing"
        self.save(session)
        self.events.emit("call_started", "Frida ti volá", detail=reason, data={"session_id": session.id})
        self._watchdogs[session.id] = asyncio.create_task(self._watchdog(session.id))
        return session

    async def hangup(self, session_id: str, reason: str = "agent") -> None:
        session = self.get(session_id)
        if session is None:
            return
        if self.live and session.twilio_sid and session.ended_at is None:
            with contextlib.suppress(Exception):
                await asyncio.to_thread(lambda: self._twilio().calls(session.twilio_sid).update(status="completed"))
        log.info("hangup %s (%s)", session_id, reason)
        self.finish(session_id)

    async def _watchdog(self, session_id: str) -> None:
        """Server-side pojistka: hovor nesmí běžet déle než call_max_seconds."""
        await asyncio.sleep(self.settings.call_max_seconds)
        session = self.get(session_id)
        if session and session.ended_at is None:
            await self.hangup(session_id, reason="max_delka")

    def on_status(self, call_sid: str, status: str) -> None:
        session = self.by_sid(call_sid)
        if session is None:
            return
        mapping = {
            "queued": "queued", "initiated": "queued", "ringing": "ringing", "in-progress": "in-progress",
            "answered": "in-progress", "completed": "completed", "busy": "failed", "no-answer": "failed",
            "failed": "failed", "canceled": "failed",
        }
        new = mapping.get(status, session.status)
        if new in ("completed", "failed"):
            self.finish(session.id, new)
        else:
            session.status = new  # type: ignore[assignment]
            self.save(session)

    async def on_amd(self, call_sid: str, answered_by: str) -> None:
        """Na záznamník nemluvíme: zavěsíme a pošleme notifikaci."""
        session = self.by_sid(call_sid)
        if session is None or answered_by.startswith("human"):
            return
        await self.hangup(session.id, reason=f"amd:{answered_by}")
        self.events.emit("system", "Hovor vzal záznamník", detail=session.reason, severity="info")

    # ------------------------------------------------------------- zprávy
    async def send_sms(self, body: str, *, to: str | None = None) -> str:
        if not self.live:
            return "simulated"
        number = normalize_phone(to or self.settings.user_phone)
        msg = await asyncio.to_thread(
            self._twilio().messages.create, to=number, from_=self.settings.twilio_from_number, body=body[:600]
        )
        return msg.sid

    async def send_whatsapp(self, body: str, *, to: str | None = None) -> str:
        if not self.live or not self.settings.twilio_whatsapp_from:
            return "simulated"
        number = normalize_phone(to or self.settings.user_phone)
        msg = await asyncio.to_thread(
            self._twilio().messages.create,
            to=f"whatsapp:{number}", from_=self.settings.twilio_whatsapp_from, body=body[:1000],
        )
        return msg.sid

    # ------------------------------------------------------------- podpis
    def validate_signature(self, url: str, params: dict, signature: str | None) -> bool:
        if not self.live or not self.settings.validate_twilio_signature:
            return True
        if not signature:
            return False
        from twilio.request_validator import RequestValidator

        assert self.settings.twilio_auth_token is not None
        return RequestValidator(self.settings.twilio_auth_token.get_secret_value()).validate(url, params, signature)

    @staticmethod
    def duration(session: CallSession, now: datetime | None = None) -> int:
        end = session.ended_at or now or utcnow()
        return int((end - session.started_at).total_seconds())
