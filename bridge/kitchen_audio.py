"""The kitchen audio relay (beats B and C, docs/handoffs/1-stage-view.md, "Update").

The audience hears the kitchen only through the stage app, never through the video call. The kitchen tablet
streams two channels here: its mic after the browser's echo cancellation (`who: "kitchen"`, the actor) and
Coldex's voice taken from the Realtime session's remote track (`who: "coldex"`). The stage listens and plays
them. Same message shape as courier.py's /listen, but 24 kHz PCM16 (little-endian, mono), not mu-law,
because this is the hero voice.

    WS /kitchen/audio    the kitchen tablet: {"who": "kitchen" | "coldex", "audio": base64 PCM16 24 kHz, "t": ms}
    WS /kitchen/listen   the stage: the same messages, fanned out as they arrive

`t` is the sender's clock when the chunk was captured, so the stage can measure the relay's latency.
"""

from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/kitchen")
_listeners: set[WebSocket] = set()


@router.websocket("/audio")
async def audio_in(ws: WebSocket) -> None:
    await ws.accept()
    try:
        while True:
            message = await ws.receive_text()
            for listener in list(_listeners):
                try:
                    await listener.send_text(message)
                except Exception:
                    _listeners.discard(listener)
    except WebSocketDisconnect:
        pass


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
