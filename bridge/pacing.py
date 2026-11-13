"""The voice is the clock: a tool call's bus events land when the voice gets there, not when the model generates it.

The realtime model generates about 3x faster than it speaks, so its tool calls hit the bridge seconds before the voice
reaches them. The client sends `X-Coldex-Show-In: <ms>` (unspoken caption chars / speech rate). The tool answers the
model at once; every event published inside that request (`tool` start/done and the tool's own) is held and
published after the delay, in order. Back-to-back tools from one screen land at least CARD_MIN_DWELL_S apart.
"""

from __future__ import annotations

import asyncio
import contextvars
import time
from typing import Any, Callable

CARD_MIN_DWELL_S = 6.0
# Tools that put a card up (app/src/stage/pick.ts TOOLS, plus the product and nearby cards). Only these get the dwell.
CARD_TOOLS = {
    "get_inventory", "update_inventory", "show_recipe", "show_shops", "show_cart", "add_to_cart", "view_cart",
    "show_product", "show_nearby", "call_courier",
}

_batch: contextvars.ContextVar[_Batch | None] = contextvars.ContextVar("coldex_show_batch", default=None)
_last: dict[str | None, float] = {}  # screen -> when its last held tool call lands (monotonic)
_pending: set[_Batch] = set()


class _Batch:
    def __init__(self, send: Callable[[str, dict[str, Any]], None]) -> None:
        self.send = send
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.flushed = False
        self.handle: asyncio.TimerHandle | None = None

    def flush(self) -> None:
        _pending.discard(self)
        self.flushed = True
        for kind, data in self.events:
            self.send(kind, data)
        self.events.clear()


def begin(name: str, headers: Any, send: Callable[[str, dict[str, Any]], None]) -> contextvars.Token | None:
    """Called by the tool middleware on the event loop. No header, no holding."""
    raw = headers.get("x-coldex-show-in")
    if raw is None:
        return None
    screen = headers.get("x-coldex-screen")
    now = time.monotonic()
    at = now + max(0.0, float(raw)) / 1000
    if name in CARD_TOOLS:  # no-card tools wait for the voice too, but don't push later cards back
        at = max(at, _last.get(screen, 0.0) + CARD_MIN_DWELL_S)
        _last[screen] = at
    batch = _Batch(send)
    batch.handle = asyncio.get_running_loop().call_later(at - now, batch.flush)
    _pending.add(batch)
    return _batch.set(batch)


def end(token: contextvars.Token | None) -> None:
    if token is not None:
        _batch.reset(token)


def hold(kind: str, data: dict[str, Any]) -> bool:
    """True if the event was queued for later. Stage events are never held."""
    batch = _batch.get()
    if batch is None or batch.flushed or kind == "stage":
        return False
    batch.events.append((kind, data))
    return True


def cancel() -> None:
    """Stage reset: drop every held event, so a rehearsal reset gets no stale cards later."""
    for batch in list(_pending):
        if batch.handle:
            batch.handle.cancel()
        batch.flushed = True  # anything the request still emits goes out live
        batch.events.clear()
    _pending.clear()
    _last.clear()
