"""Vnitřní sběrnice událostí.

Moduly (kamera, vision, inventář, agent, hlas) publikují zprávy sem a WebSocket
hub je rozesílá všem otevřeným prohlížečům. Každý odběratel má vlastní frontu,
takže pomalý klient nezdrží ostatní.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from pydantic import BaseModel

from .db import utcnow
from .schemas import WsEnvelope, WsType

log = logging.getLogger(__name__)


class EventBus:
    def __init__(self, queue_size: int = 256) -> None:
        self._subscribers: set[asyncio.Queue[WsEnvelope]] = set()
        self._queue_size = queue_size
        self.history: list[WsEnvelope] = []  # posledních pár zpráv kvůli testům a ladění

    def publish(self, type_: WsType, payload: BaseModel | dict[str, Any] | None = None) -> WsEnvelope:
        if isinstance(payload, BaseModel):
            data = payload.model_dump(mode="json")
        else:
            data = payload or {}
        env = WsEnvelope(type=type_, ts=utcnow(), payload=data)
        self.history.append(env)
        del self.history[:-200]
        for q in list(self._subscribers):
            try:
                q.put_nowait(env)
            except asyncio.QueueFull:
                # Klient nestíhá - zahodíme nejstarší zprávu, ať nezamrzne celý systém.
                try:
                    q.get_nowait()
                    q.put_nowait(env)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    log.warning("bus: dropping message for slow subscriber")
        return env

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[WsEnvelope]]:
        q: asyncio.Queue[WsEnvelope] = asyncio.Queue(maxsize=self._queue_size)
        self._subscribers.add(q)
        try:
            yield q
        finally:
            self._subscribers.discard(q)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)
