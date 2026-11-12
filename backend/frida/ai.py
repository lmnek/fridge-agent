"""Sdílené nastavení pro volání Claude (Anthropic API, přímo, ne přes AWS).

- Model: `claude-opus-5-5` (lze změnit `FRIDA_AGENT_MODEL`).
- Thinking je u Opus 5.5 vždy zapnuté, hloubku řídí `output_config.effort`
  (výchozí je u tohoto modelu `medium`, proto ho nastavujeme vždy výslovně).
- Server-side fallback (beta `server-side-fallback-2026-07-01`, `fallbacks="default"`):
  když model požadavek odmítne kvůli bezpečnostním pravidlům, API ho samo zkusí
  na záložním modelu. Vypnutí: `FRIDA_AGENT_FALLBACKS=false`.
"""

from __future__ import annotations

from typing import Any

from anthropic import AsyncAnthropic

from .config import Settings

FALLBACK_BETA = "server-side-fallback-2026-07-01"


def make_client(settings: Settings) -> AsyncAnthropic | None:
    if not settings.has_anthropic:
        return None
    assert settings.anthropic_api_key is not None
    return AsyncAnthropic(api_key=settings.anthropic_api_key.get_secret_value(), max_retries=3)


def request_kwargs(settings: Settings, effort: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": settings.agent_model,
        "output_config": {"effort": effort},
    }
    if settings.agent_fallbacks:
        kwargs["betas"] = [FALLBACK_BETA]
        kwargs["fallbacks"] = "default"
    return kwargs
