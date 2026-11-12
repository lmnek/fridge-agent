"""Pojistky pro volání (vzor převzatý z AI Volavky, jen myšlenka, ne kód).

- Volat jde jen na čísla v allowlistu.
- Limity hovorů za hodinu a za den.
- Tiché hodiny: v noci se nevolá.
- Každý hovor má maximální délku, po které ho server sám ukončí.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..config import Settings
from ..db import utcnow

E164 = re.compile(r"^\+[1-9]\d{7,14}$")


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"[^\d+]", "", raw or "")
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if digits and not digits.startswith("+") and len(digits) == 9:
        digits = "+420" + digits  # české číslo bez předvolby
    return digits


def mask_phone(number: str) -> str:
    n = normalize_phone(number)
    return n[:4] + " ••• ••• " + n[-3:] if len(n) > 7 else "•••"


@dataclass
class Decision:
    allowed: bool
    reason: str


class CallPolicy:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.tz = ZoneInfo(settings.timezone)
        self._lock = threading.Lock()
        self._started: list[datetime] = []

    def allowlist(self) -> set[str]:
        numbers = {normalize_phone(n) for n in self.settings.allowed_call_numbers}
        if self.settings.user_phone and not self.settings.allowed_call_numbers:
            # Když allowlist není vyplněný, smí se volat jen na vlastní číslo uživatele.
            numbers.add(normalize_phone(self.settings.user_phone))
        return {n for n in numbers if n}

    def in_quiet_hours(self, now: datetime | None = None) -> bool:
        hour = (now or utcnow()).astimezone(self.tz).hour
        start, end = self.settings.quiet_hours_start, self.settings.quiet_hours_end
        return (start <= hour or hour < end) if start > end else (start <= hour < end)

    def check(self, to: str, *, urgent: bool = False, now: datetime | None = None) -> Decision:
        now = now or utcnow()
        number = normalize_phone(to)
        if not E164.match(number):
            return Decision(False, "Neplatné telefonní číslo (čekám formát +420…).")
        if number not in self.allowlist():
            return Decision(False, "Číslo není v allowlistu FRIDA_ALLOWED_CALL_NUMBERS.")
        if self.in_quiet_hours(now) and not urgent:
            return Decision(False, "Tiché hodiny, místo hovoru posílám tichou notifikaci.")
        with self._lock:
            self._started = [t for t in self._started if now - t < timedelta(days=1)]
            if sum(1 for t in self._started if now - t < timedelta(hours=1)) >= self.settings.calls_per_hour:
                return Decision(False, f"Limit {self.settings.calls_per_hour} hovorů za hodinu.")
            if len(self._started) >= self.settings.calls_per_day:
                return Decision(False, f"Denní limit {self.settings.calls_per_day} hovorů.")
        return Decision(True, "ok")

    def record_start(self, now: datetime | None = None) -> None:
        with self._lock:
            self._started.append(now or utcnow())
