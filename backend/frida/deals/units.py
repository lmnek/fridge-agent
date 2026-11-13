"""Jednotkové ceny: '1,5 l' -> (1.5, 'l'), '500 g' -> (0.5, 'kg'), '10 ks' -> (10, 'ks')."""

from __future__ import annotations

import re

_PACK = re.compile(
    r"(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|dkg|l|ml|cl|ks|kus[uy]?|pcs)\b", re.IGNORECASE
)


def parse_package(text: str | None) -> tuple[float, str] | None:
    """Vrátí množství v základní jednotce (kg, l, ks)."""
    if not text:
        return None
    m = _PACK.search(text.replace(" ", " "))
    if not m:
        return None
    multiplier = int(m[1]) if m[1] else 1
    amount = float(m[2].replace(",", ".")) * multiplier
    unit = m[3].lower()
    if unit == "g":
        return amount / 1000, "kg"
    if unit == "dkg":
        return amount / 100, "kg"
    if unit == "ml":
        return amount / 1000, "l"
    if unit == "cl":
        return amount / 100, "l"
    if unit.startswith("kus") or unit == "pcs":
        return amount, "ks"
    return amount, unit  # kg | l | ks


def unit_price(price_czk: float, package: str | None) -> tuple[float, str] | None:
    parsed = parse_package(package)
    if not parsed or parsed[0] <= 0:
        return None
    amount, unit = parsed
    return round(price_czk / amount, 2), unit
