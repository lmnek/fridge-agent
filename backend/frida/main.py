"""FastAPI aplikace Fridy.

Spuštění: `uv run frida serve` (nebo `uv run uvicorn frida.main:app --reload`).
Bez jakékoli konfigurace běží celé v demo režimu.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .api import core, realtime, shopping
from .config import Settings, get_settings
from .seed import seed_demo
from .services import build_services

log = logging.getLogger("frida")

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
API_PREFIXES = {"api", "voice", "ws", "healthz", "docs", "openapi.json", "assets"}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        svc = build_services(settings)
        app.state.svc = svc
        await seed_demo(svc)
        await svc.start()
        modes = svc.integration_modes()
        log.info("Frida %s běží. Integrace: %s", __version__, ", ".join(f"{k}={v}" for k, v in modes.items()))
        try:
            yield
        finally:
            await svc.stop()

    app = FastAPI(title="Frida", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin, "http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(core.router)
    app.include_router(shopping.router)
    app.include_router(realtime.router)

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"ok": True, "version": __version__}

    # Sestavený frontend (npm run build) servíruje rovnou backend, stačí jeden proces.
    if FRONTEND_DIST.exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str) -> FileResponse:
            if path.split("/", 1)[0] in API_PREFIXES:
                raise HTTPException(404, "Not Found")  # neznámé API nesmí vracet index.html
            candidate = (FRONTEND_DIST / path).resolve()
            if path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(FRONTEND_DIST / "index.html")

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
