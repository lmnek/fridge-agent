"""Demo zdroj akcí: deterministické, ale věrohodné akce pro potraviny z katalogu.

Je jasně označený (`source="demo"`), aby si ho nikdo nespletl se skutečnými
cenami. Skutečné zdroje jsou v `kupi.py` a `akcniceny.py`.
"""

from __future__ import annotations

import hashlib
from datetime import date, timedelta

from ..food.catalog import find_spec
from ..schemas import Deal
from .units import unit_price

CHAINS = ("Albert", "Lidl", "Billa", "Kaufland", "Penny", "Tesco", "Globus")
CARD_CHAINS = {"Lidl": "Lidl Plus", "Albert": "Albert Bonus", "Billa": "Billa Bonus"}
_PACKAGES = {"l": "1 l", "kg": "1 kg", "g": "500 g", "ks": "1 ks", "bal": "1 bal", "ml": "500 ml"}


def _h(*parts: str) -> int:
    return int(hashlib.sha256("|".join(parts).encode()).hexdigest()[:8], 16)


class DemoDealSource:
    name = "demo"

    def __init__(self, today: date | None = None) -> None:
        self.today = today or date.today()

    async def search(self, query: str) -> list[Deal]:
        spec = find_spec(query)
        if spec is None:
            return []
        week = self.today.isocalendar().week
        deals: list[Deal] = []
        for chain in CHAINS:
            seed = _h(spec.key, chain, str(week))
            if seed % 100 < 38:  # ne každý řetězec má na všechno akci
                continue
            regular = spec.typical_price_czk or 30
            discount = 10 + seed % 36  # 10 až 45 %
            price = round(regular * (100 - discount) / 100 - 0.1, 1)
            start = self.today - timedelta(days=seed % 4)
            package = _PACKAGES.get(spec.unit, "1 ks")
            up = unit_price(price, package)
            deals.append(
                Deal(
                    id=f"demo-{spec.key}-{chain.lower()}-{week}",
                    product_name=f"{spec.name} {package}",
                    canonical=spec.key,
                    chain=chain,
                    price_czk=price,
                    original_price_czk=regular,
                    discount_pct=discount,
                    unit_price=up[0] if up else None,
                    unit_price_unit=up[1] if up else None,  # type: ignore[arg-type]
                    package=package,
                    valid_from=start,
                    valid_to=start + timedelta(days=6),
                    requires_card=chain in CARD_CHAINS and seed % 3 == 0,
                    source="demo",
                    url=None,
                )
            )
        return deals
