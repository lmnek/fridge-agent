from __future__ import annotations

from fastapi import Request, WebSocket

from ..services import Services


def get_svc(request: Request) -> Services:
    return request.app.state.svc


def ws_svc(ws: WebSocket) -> Services:
    return ws.app.state.svc
