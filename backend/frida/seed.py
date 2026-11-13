"""Ukázková data pro první spuštění v demo režimu.

Lednice se nenaplní ručně, ale stejnou cestou jako u skutečné kamery:
otevřou se dveře, obě demo kamery vyfotí scénu, vision ji rozpozná a inventář
se spáruje. K tomu se dopočítá historie (spotřeba, vyhozené jídlo, otevírání
dveří, ceny), aby grafy a predikce měly z čeho počítat.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import timedelta

from .db import utcnow
from .food.catalog import BY_KEY
from .inventory import CONSUMPTION, ITEMS, WASTE
from .schemas import InventoryItemCreate
from .services import Services

log = logging.getLogger(__name__)

SAVINGS = "savings"

# kanonický klíč -> spotřeba za den (v jednotkách katalogu)
DAILY_USE = {
    "mleko": 0.35,
    "vejce": 1.2,
    "jogurt-bily": 0.6,
    "maslo": 0.06,
    "syr-eidam": 0.15,
    "rajcata": 0.6,
    "jablka": 0.7,
    "toustovy-chleb": 0.12,
    "kefir": 0.2,
    "sunka": 0.15,
    "dzus": 0.2,
    "pivo": 0.4,
}
WASTED = ("jahody", "salat", "smetana", "zbytky-jidla", "sunka", "rajcata", "jogurt-bily", "hermelin")


def _h(*parts: object) -> int:
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


async def seed_demo(svc: Services) -> bool:
    if not svc.settings.demo_seed or svc.store.count(ITEMS) > 0:
        return False
    now = utcnow()

    if svc.demo_world is not None:
        for cam_id in svc.cameras.cameras:
            svc.cameras._set_door(cam_id, True)
            await svc.cameras.capture(cam_id, reason="manual")
            svc.cameras._set_door(cam_id, False)
        svc.cameras.store.clear("door_opens")
        # jedna základní potravina, která už došla (ať je co doplnit)
        out = svc.inventory.create(
            InventoryItemCreate(
                name="Smetana na vaření",
                category="dairy",
                quantity=0,
                min_quantity=1,
                staple=True,
                shelf="middle",
                price_czk=30,
            ),
            source="demo",
            emit=False,
        )
        log.info("demo: došlá položka %s", out.name)

    # spotřeba za 4 týdny
    rows = []
    for key, per_day in DAILY_USE.items():
        spec = BY_KEY.get(key)
        if spec is None:
            continue
        for day in range(28, 0, -1):
            if _h(key, day) % 3 == 0:
                continue
            ts = now - timedelta(days=day, hours=_h(key, day, "h") % 12)
            rows.append(
                (
                    f"seed_c_{key}_{day}",
                    {
                        "canonical": key,
                        "name": spec.name,
                        "emoji": spec.emoji,
                        "amount": round(per_day * 1.5, 3),
                        "unit": spec.unit,
                        "ts": ts.isoformat(),
                    },
                    ts,
                )
            )
    for doc_id, data, ts in rows:
        svc.store.put(CONSUMPTION, doc_id, data, ts=ts)

    # vyhozené jídlo za 6 měsíců (klesá, ať je vidět, že Frida pomáhá)
    for month in range(6):
        count = 1 + month  # dřív se vyhazovalo víc, s Fridou méně
        for n in range(count):
            key = WASTED[_h(month, n) % len(WASTED)]
            spec = BY_KEY.get(key)
            ts = (
                (now.replace(day=1) - timedelta(days=30 * month - 3 - n * 4))
                if month
                else now - timedelta(days=n + 1)
            )
            if ts > now:
                ts = now - timedelta(hours=n + 1)
            svc.store.put(
                WASTE,
                f"seed_w_{month}_{n}",
                {
                    "canonical": key,
                    "name": spec.name if spec else key,
                    "czk": round(
                        (spec.typical_price_czk if spec else 40) * (0.4 + (_h(key, n) % 60) / 100), 1
                    ),
                    "ts": ts.isoformat(),
                },
                ts=ts,
            )

    # otevírání dveří dnes (podle hodin)
    local = now.astimezone(svc.tz)
    for hour in range(6, local.hour + 1):
        for n in range(_h(hour, "door") % 3 if hour in (7, 8, 12, 13, 18, 19, 20, 21) else _h(hour) % 2):
            ts = local.replace(hour=hour, minute=(n * 17 + 5) % 60, second=0, microsecond=0)
            svc.store.put(
                "door_opens", f"seed_d_{hour}_{n}", {"camera_id": "cam0", "ts": ts.isoformat()}, ts=ts
            )

    # ušetřeno díky akcím tento měsíc
    for n in range(5):
        ts = now - timedelta(days=n * 5 + 1)
        svc.store.put(
            SAVINGS, f"seed_s_{n}", {"czk": round(18 + _h(n, "s") % 60, 1), "ts": ts.isoformat()}, ts=ts
        )

    svc.deals.seed_demo_history()
    svc.inventory.check_alerts()
    svc.events.emit(
        "system",
        "Frida běží v demo režimu",
        detail="Kamery, ceny i Rohlík jsou simulované. Skutečné služby připojíš podle docs/napojeni.md.",
    )
    svc.inventory.broadcast()
    return True


def savings_month(svc: Services) -> float:
    start = utcnow().astimezone(svc.tz).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rows = svc.store.list_raw(SAVINGS, since=start)
    return round(sum(r["czk"] for r in rows), 1)
