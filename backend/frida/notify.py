"""Kdy a jak Frida dá vědět.

Pravidla (dají se upravit tady na jednom místě):
- Každá důležitá událost (dochází, došlo, končí trvanlivost, dveře otevřené)
  -> tichá notifikace v aplikaci (push přes WebSocket), podle nastavení uživatele.
- Dveře lednice otevřené déle než `door_open_alert_seconds` -> hovor (urgentní,
  volá se i v tichých hodinách, protože se kazí jídlo).
- Došly aspoň `call_when_staples_out` základní potraviny -> jeden hovor denně
  s nabídkou, že Frida naplní košík v Rohlíku (v tichých hodinách se nevolá).
- Volitelně SMS nebo WhatsApp pro kritické věci (`FRIDA_NOTIFY_SMS`, `FRIDA_NOTIFY_WHATSAPP`).
- Každé ráno v `digest_hour` souhrn: co dnes spotřebovat, co dochází.

Každý hovor ještě hlídá `CallPolicy` (allowlist, limity, tiché hodiny).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from .bus import EventBus
from .config import Settings
from .db import DocStore, utcnow
from .events import EventLog
from .inventory import InventoryService
from .prefs import PrefsService
from .schemas import Channel, FridgeEvent, Notification
from .voice.service import VoiceService

log = logging.getLogger(__name__)

NOTIFICATIONS = "notifications"
SENT_MARKS = "notify_marks"  # deduplikace: "call-staples:2026-11-13", "digest:2026-11-13"

PUSH_KINDS = {
    "item_low": "low",
    "item_out": "low",
    "item_expiring": "expiry",
    "item_expired": "expiry",
    "door_open_too_long": "always",
    "order_placed": "always",
    "deal_found": "always",
}


class NotificationService:
    def __init__(
        self,
        settings: Settings,
        store: DocStore,
        bus: EventBus,
        events: EventLog,
        voice: VoiceService,
        inventory: InventoryService,
        prefs: PrefsService,
    ) -> None:
        self.settings = settings
        self.store = store
        self.bus = bus
        self.events = events
        self.voice = voice
        self.inventory = inventory
        self.prefs = prefs
        self.tz = ZoneInfo(settings.timezone)
        self._tasks: set[asyncio.Task] = set()
        events.on_event(self._on_event)

    # ------------------------------------------------------------- záznam
    def record(
        self,
        channel: Channel,
        title: str,
        body: str,
        *,
        status: str,
        reason: str | None = None,
        event_id: str | None = None,
    ) -> Notification:
        n = Notification(
            id=f"ntf_{uuid.uuid4().hex[:10]}",
            ts=utcnow(),
            channel=channel,
            title=title,
            body=body,
            status=status,  # type: ignore[arg-type]
            reason=reason,
            event_id=event_id,
        )
        self.store.put(NOTIFICATIONS, n.id, n, ts=n.ts)
        self.bus.publish("notification", n)
        return n

    def recent(self, limit: int = 50) -> list[Notification]:
        return self.store.list(NOTIFICATIONS, Notification, limit=limit)

    def _once(self, mark: str) -> bool:
        if self.store.get_raw(SENT_MARKS, mark):
            return False
        self.store.put(SENT_MARKS, mark, {"at": utcnow().isoformat()})
        return True

    def _today(self) -> str:
        return utcnow().astimezone(self.tz).date().isoformat()

    # ------------------------------------------------------------- události
    def _on_event(self, ev: FridgeEvent) -> None:
        rule = PUSH_KINDS.get(ev.kind)
        if rule is None:
            return
        prefs = self.prefs.get()
        if (rule == "low" and not prefs.notify_low_stock) or (rule == "expiry" and not prefs.notify_expiry):
            return
        self.record("push", ev.title, ev.detail or "", status="sent", event_id=ev.id)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # bez běžící smyčky (CLI, testy) jen push
        task = loop.create_task(self._escalate(ev))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _escalate(self, ev: FridgeEvent) -> None:
        try:
            if ev.kind == "door_open_too_long":
                await self.call(
                    "Dveře od lednice jsou pořád otevřené. Zavřeš je prosím?", urgent=True, event_id=ev.id
                )
                await self.message(f"Frida: {ev.title}", critical=True)
            elif ev.kind == "item_out":
                staples = [i for i in self.inventory.list() if i.staple and i.status == "out"]
                if len(staples) >= self.settings.call_when_staples_out and self._once(
                    f"call-staples:{self._today()}"
                ):
                    lowered = [i.name.lower() for i in staples[:4]]
                    names = lowered[0] if len(lowered) == 1 else ", ".join(lowered[:-1]) + " a " + lowered[-1]
                    await self.call(
                        f"Došlo ti {names}. Mám to dát do košíku v Rohlíku, nebo najít akci v okolí?",
                        event_id=ev.id,
                    )
        except Exception:
            log.exception("eskalace notifikace selhala")

    # ------------------------------------------------------------- kanály
    async def call(self, reason: str, *, urgent: bool = False, event_id: str | None = None) -> Notification:
        prefs = self.prefs.get()
        if not prefs.allow_calls:
            return self.record(
                "call",
                "Hovor vynechán",
                reason,
                status="suppressed",
                reason="Hovory máš v nastavení vypnuté.",
                event_id=event_id,
            )
        session = await self.voice.call_user(reason, urgent=urgent)
        status = {"simulated": "simulated", "refused": "suppressed", "failed": "failed"}.get(
            session.status, "sent"
        )
        why = None
        if session.status == "refused":
            why = "Hovor zablokovala pojistka (allowlist, limit nebo tiché hodiny)."
        elif session.status == "simulated":
            why = "Demo režim bez Twilia, hovor přijmeš v aplikaci."
        return self.record("call", "Frida volá", reason, status=status, reason=why, event_id=event_id)

    async def message(self, body: str, *, critical: bool = False) -> None:
        if not critical:
            return
        if self.settings.notify_sms:
            sid = await self.voice.send_sms(body)
            self.record("sms", "SMS", body, status="simulated" if sid == "simulated" else "sent")
        if self.settings.notify_whatsapp:
            sid = await self.voice.send_whatsapp(body)
            self.record("whatsapp", "WhatsApp", body, status="simulated" if sid == "simulated" else "sent")

    # ------------------------------------------------------------- denní souhrn
    def digest(self) -> Notification | None:
        items = self.inventory.list()
        expiring = sorted(
            (i for i in items if i.status in ("expiring", "expired")), key=lambda i: i.days_left or 0
        )
        low = [i for i in items if i.status in ("low", "out")]
        if not expiring and not low:
            return None
        parts = []
        if expiring:
            parts.append("Dnes spotřebuj: " + ", ".join(i.name for i in expiring[:5]) + ".")
        if low:
            parts.append("Dochází: " + ", ".join(i.name for i in low[:5]) + ".")
        return self.record("push", "Ranní souhrn od Fridy", " ".join(parts), status="sent")

    async def run_scheduler(self, *, interval_s: float = 600) -> None:
        """Smyčka na pozadí: kontrola trvanlivosti a ranní souhrn."""
        while True:
            try:
                self.inventory.check_alerts()
                now: datetime = utcnow().astimezone(self.tz)
                if now.hour >= self.settings.digest_hour and self._once(f"digest:{now.date().isoformat()}"):
                    self.digest()
            except Exception:
                log.exception("plánovač notifikací")
            await asyncio.sleep(interval_s)

    async def close(self) -> None:
        for t in list(self._tasks):
            t.cancel()
            with contextlib.suppress(BaseException):
                await t
