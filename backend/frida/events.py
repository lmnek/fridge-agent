"""Časová osa: uložení události + rozeslání do UI."""

from __future__ import annotations

import uuid
from typing import Any

from .bus import EventBus
from .db import DocStore, utcnow
from .schemas import EventKind, FridgeEvent, Severity


class EventLog:
    COLLECTION = "events"

    def __init__(self, store: DocStore, bus: EventBus) -> None:
        self.store = store
        self.bus = bus
        self._listeners: list = []

    def on_event(self, callback) -> None:
        """Synchronní posluchač (např. notifikace), volá se po každé nové události."""
        self._listeners.append(callback)

    def emit(
        self,
        kind: EventKind,
        title: str,
        *,
        detail: str | None = None,
        severity: Severity = "info",
        item_id: str | None = None,
        camera_id: str | None = None,
        image_url: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> FridgeEvent:
        event = FridgeEvent(
            id=f"evt_{uuid.uuid4().hex[:12]}",
            ts=utcnow(),
            kind=kind,
            title=title,
            detail=detail,
            severity=severity,
            item_id=item_id,
            camera_id=camera_id,
            image_url=image_url,
            data=data or {},
        )
        self.store.put(self.COLLECTION, event.id, event, ts=event.ts)
        self.bus.publish("event", event)
        for callback in list(self._listeners):
            callback(event)
        return event

    def recent(self, limit: int = 50) -> list[FridgeEvent]:
        return self.store.list(self.COLLECTION, FridgeEvent, limit=limit)
