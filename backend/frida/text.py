"""Práce s českým textem: normalizace, tokeny, podobnost názvů."""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

_STOPWORDS = {
    "a",
    "s",
    "se",
    "v",
    "ve",
    "na",
    "z",
    "ze",
    "do",
    "pro",
    "bez",
    "the",
    "ks",
    "kus",
    "kusy",
    "bal",
    "baleni",
    "g",
    "kg",
    "ml",
    "l",
    "litr",
    "cca",
    "x",
}

_SPACES = re.compile(r"\s+")
_NON_WORD = re.compile(r"[^a-z0-9 ]+")


def strip_diacritics(text: str) -> str:
    norm = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in norm if not unicodedata.combining(ch))


def normalize(text: str) -> str:
    """'Mléko polotučné 1,5 %' -> 'mleko polotucne 1 5'."""
    text = strip_diacritics(text.lower())
    text = _NON_WORD.sub(" ", text)
    return _SPACES.sub(" ", text).strip()


def tokens(text: str) -> list[str]:
    return [t for t in normalize(text).split() if t not in _STOPWORDS and not t.isdigit()]


def slug(text: str) -> str:
    return "-".join(tokens(text)) or normalize(text).replace(" ", "-") or "item"


def _stem(token: str) -> str:
    """Velmi hrubé české 'stemování': utne běžné koncovky, aby 'jogurty' == 'jogurt'."""
    for suffix in (
        "ovych",
        "ove",
        "ova",
        "ovy",
        "ych",
        "ich",
        "ech",
        "ami",
        "emi",
        "ky",
        "ek",
        "ka",
        "ou",
        "y",
        "u",
        "e",
        "a",
        "i",
        "o",
    ):
        if len(token) > len(suffix) + 2 and token.endswith(suffix):
            return token[: -len(suffix)]
    return token


def similarity(a: str, b: str) -> float:
    """Podobnost dvou názvů potravin 0..1 (tokeny se stemy + znaková podobnost)."""
    ta = {_stem(t) for t in tokens(a)}
    tb = {_stem(t) for t in tokens(b)}
    if not ta or not tb:
        return 0.0
    overlap = len(ta & tb)
    jaccard = overlap / len(ta | tb)
    # Hledaný výraz bývá kratší než název produktu ("mléko" vs "Mléko Madeta polotučné 1 l"),
    # proto počítáme i pokrytí kratší strany.
    coverage = overlap / min(len(ta), len(tb))
    chars = SequenceMatcher(None, normalize(a), normalize(b)).ratio()
    return round(min(1.0, 0.45 * coverage + 0.35 * jaccard + 0.2 * chars), 4)


def czk(value: float | None) -> str:
    """49 -> '49 Kč', 30.1 -> '30,10 Kč' (česky s desetinnou čárkou)."""
    if value is None:
        return "? Kč"
    if abs(value - round(value)) < 0.005:
        return f"{round(value):d} Kč"
    return f"{value:.2f} Kč".replace(".", ",")


def km(meters: float | None) -> str:
    if meters is None:
        return "? km"
    if meters < 1000:
        return f"{round(meters / 10) * 10:d} m"
    return f"{meters / 1000:.1f} km".replace(".", ",")
