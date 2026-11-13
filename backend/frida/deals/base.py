"""Rozhraní zdroje akcí (letáky, agregátory, e-shopy)."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..schemas import Deal


class DealSourceError(RuntimeError):
    """Zdroj je nedostupný. Nesmí to vypadat jako 'žádné akce'."""


@runtime_checkable
class DealSource(Protocol):
    name: str

    async def search(self, query: str) -> list[Deal]: ...
