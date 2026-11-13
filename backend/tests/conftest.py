"""Společné fixtury: izolované nastavení v demo režimu (bez klíčů, bez .env)."""

from __future__ import annotations

import os

import pytest

from frida.config import Settings


@pytest.fixture
def settings(tmp_path, monkeypatch) -> Settings:
    for key in list(os.environ):
        if key.startswith("FRIDA_") or key in ("ANTHROPIC_API_KEY",):
            monkeypatch.delenv(key, raising=False)
    return Settings(_env_file=None, data_dir=tmp_path, demo_seed=True)


@pytest.fixture
async def services(settings):
    from frida.services import build_services

    svc = build_services(settings)
    try:
        yield svc
    finally:
        await svc.stop()
