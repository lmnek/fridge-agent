"""Čtení data spotřeby z textu na obalu.

Česká balení používají dva druhy dat:
- "Spotřebujte do" (use by): po datu se nemá jíst, typicky maso, mléčné.
- "Minimální trvanlivost do" (best before, DMT): po datu je to většinou v pořádku.
U DMT bývá i jen měsíc a rok ("MDT 03/2027"), pak bereme poslední den měsíce.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date
from typing import Literal

from ..text import strip_diacritics

ExpiryKind = Literal["use_by", "best_before", "unknown"]

_USE_BY = re.compile(r"spotreb\w*\s*(?:do)?|use\s*by|exp(?:iry|\.)?\b|expirace|pouzit(?:elne)?\s*do", re.I)
_BEST_BEFORE = re.compile(
    r"minim\w*\s*trvanlivost\w*|min\.?\s*trv\.?|\bdmt\b|\bmdt\b|best\s*before|\bbb\b|trvanlivost", re.I
)

_FULL = re.compile(r"(?<!\d)(\d{1,2})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{2,4})(?!\d)")
_ISO = re.compile(r"(?<!\d)(20\d{2})-(\d{1,2})-(\d{1,2})(?!\d)")
_SPACED = re.compile(r"(?<!\d)(\d{2})\s(\d{2})\s(\d{2,4})(?!\d)")
_MONTH_YEAR = re.compile(r"(?<![\d.])(\d{1,2})\s*[./]\s*(20\d{2})(?!\d)")
_DAY_MONTH = re.compile(r"(?<!\d)(\d{1,2})\s*\.\s*(\d{1,2})\s*\.(?!\s*\d)")


@dataclass(frozen=True)
class ParsedExpiry:
    on: date
    kind: ExpiryKind
    text: str
    month_only: bool = False


def _year(y: int) -> int:
    return 2000 + y if y < 100 else y


def _safe(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def parse_expiry(text: str, *, today: date | None = None) -> ParsedExpiry | None:
    """Najde v textu datum spotřeby. Vrací None, když tam žádné rozumné datum není."""
    if not text:
        return None
    today = today or date.today()
    plain = strip_diacritics(text).lower()
    kind: ExpiryKind = "unknown"
    if _USE_BY.search(plain):
        kind = "use_by"
    if _BEST_BEFORE.search(plain):
        kind = "best_before"

    candidates: list[tuple[date, bool]] = []
    for m in _ISO.finditer(plain):
        if (d := _safe(int(m[1]), int(m[2]), int(m[3]))) is not None:
            candidates.append((d, False))
    for m in _FULL.finditer(plain):
        if (d := _safe(_year(int(m[3])), int(m[2]), int(m[1]))) is not None:
            candidates.append((d, False))
    if not candidates:
        for m in _SPACED.finditer(plain):
            if (d := _safe(_year(int(m[3])), int(m[2]), int(m[1]))) is not None:
                candidates.append((d, False))
    if not candidates:
        for m in _MONTH_YEAR.finditer(plain):
            month, year = int(m[1]), int(m[2])
            if 1 <= month <= 12:
                last = calendar.monthrange(year, month)[1]
                candidates.append((date(year, month, last), True))
    if not candidates:
        for m in _DAY_MONTH.finditer(plain):
            day, month = int(m[1]), int(m[2])
            for year in (today.year, today.year + 1, today.year - 1):
                d = _safe(year, month, day)
                # Bez roku bereme nejbližší výskyt v rozumném okně (-60 až +300 dní).
                if d is not None and -60 <= (d - today).days <= 300:
                    candidates.append((d, False))
                    break

    plausible = [(d, mo) for d, mo in candidates if -400 <= (d - today).days <= 365 * 4]
    if not plausible:
        return None
    # Na obalu bývá i datum výroby. Datum spotřeby je to pozdější.
    on, month_only = max(plausible, key=lambda t: t[0])
    if kind == "unknown" and month_only:
        kind = "best_before"
    return ParsedExpiry(on=on, kind=kind, text=text.strip(), month_only=month_only)
