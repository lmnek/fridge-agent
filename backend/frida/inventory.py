"""Inventář lednice.

Drží seznam potravin, počítá jejich stav (dochází, expiruje...), páruje nové
detekce z kamery s tím, co už v lednici je, a z historie spotřeby odhaduje,
kdy která věc dojde.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .bus import EventBus
from .db import DocStore
from .events import EventLog
from .food.catalog import BY_KEY, canonical_for, estimate_expiry, find_spec
from .schemas import (
    BBox,
    ConsumptionStat,
    Detection,
    InventoryDiff,
    InventoryItem,
    InventoryItemCreate,
    InventoryItemUpdate,
    InventorySummary,
    ItemStatus,
    Observation,
)
from .text import similarity

ITEMS = "items"
CONSUMPTION = "consumption"  # {canonical, name, emoji, amount, unit, ts}
WASTE = "waste"  # {canonical, name, czk, ts}
ALERTS = "alerts"  # deduplikace upozornění: id = f"{kind}:{item_id}:{den}"

EXPIRING_DAYS = 2
LOW_FILL = 0.25
MIN_DETECTION_CONFIDENCE = 0.45


def iou(a: BBox | None, b: BBox | None) -> float:
    if a is None or b is None:
        return 0.0
    x1, y1 = max(a.x, b.x), max(a.y, b.y)
    x2, y2 = min(a.x + a.w, b.x + b.w), min(a.y + a.h, b.y + b.h)
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


def overlaps_any(box: BBox | None, regions: list[BBox], min_iou: float = 0.05) -> bool:
    if box is None:
        return False
    return any(iou(box, r) >= min_iou or _contains(r, box) for r in regions)


def _contains(outer: BBox, inner: BBox) -> bool:
    cx, cy = inner.x + inner.w / 2, inner.y + inner.h / 2
    return outer.x <= cx <= outer.x + outer.w and outer.y <= cy <= outer.y + outer.h


class InventoryService:
    def __init__(
        self,
        store: DocStore,
        bus: EventBus,
        events: EventLog,
        *,
        tz: str = "Europe/Prague",
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.store = store
        self.bus = bus
        self.events = events
        self.tz = ZoneInfo(tz)
        self.clock = clock or (lambda: datetime.now(UTC))
        self._misses: dict[str, int] = defaultdict(int)

    # ------------------------------------------------------------------ util
    def today(self) -> date:
        return self.clock().astimezone(self.tz).date()

    def _with_status(self, item: InventoryItem) -> InventoryItem:
        today = self.today()
        days_left = (item.expires_on - today).days if item.expires_on else None
        status: ItemStatus = "ok"
        if item.quantity <= 0:
            status = "out"
        elif days_left is not None and days_left < 0:
            status = "expired"
        elif days_left is not None and days_left <= EXPIRING_DAYS:
            status = "expiring"
        elif (item.min_quantity and item.quantity <= item.min_quantity) or (
            item.fill_level is not None and item.fill_level <= LOW_FILL
        ):
            status = "low"
        predicted = self._predict_out(item)
        return item.model_copy(update={"status": status, "days_left": days_left, "predicted_out_on": predicted})

    def _save(self, item: InventoryItem) -> InventoryItem:
        item = self._with_status(item)
        self.store.put(ITEMS, item.id, item, ts=item.added_at)
        return item

    def broadcast(self) -> None:
        self.bus.publish(
            "inventory",
            {
                "items": [i.model_dump(mode="json") for i in self.list()],
                "summary": self.summary().model_dump(mode="json"),
            },
        )

    # ------------------------------------------------------------------ čtení
    def list(self, *, include_out: bool = True) -> list[InventoryItem]:
        items = [self._with_status(i) for i in self.store.list(ITEMS, InventoryItem)]
        if not include_out:
            items = [i for i in items if i.status != "out"]
        order = {"expired": 0, "expiring": 1, "out": 2, "low": 3, "ok": 4}
        return sorted(items, key=lambda i: (order[i.status], i.days_left if i.days_left is not None else 999, i.name))

    def get(self, item_id: str) -> InventoryItem | None:
        item = self.store.get(ITEMS, item_id, InventoryItem)
        return self._with_status(item) if item else None

    def find(self, text: str) -> list[InventoryItem]:
        canonical = canonical_for(text)
        scored = []
        for item in self.list():
            score = 1.0 if item.canonical == canonical else similarity(text, item.name)
            if score >= 0.5:
                scored.append((score, item))
        return [i for _, i in sorted(scored, key=lambda t: -t[0])]

    def summary(self) -> InventorySummary:
        items = self.list()
        present = [i for i in items if i.status != "out"]
        counts = defaultdict(int)
        for i in items:
            counts[i.status] += 1
        value = sum((i.price_czk or 0) * (i.fill_level if i.fill_level is not None else 1) for i in present)
        fresh_penalty = counts["expired"] * 18 + counts["expiring"] * 7 + counts["low"] * 3 + counts["out"] * 2
        freshness = max(0, min(100, 100 - fresh_penalty)) if items else 100
        month_start = self.today().replace(day=1)
        waste = sum(
            w["czk"]
            for w in self.store.list_raw(WASTE)
            if datetime.fromisoformat(w["ts"]).astimezone(self.tz).date() >= month_start
        )
        return InventorySummary(
            total_items=len(present),
            low=counts["low"],
            out=counts["out"],
            expiring=counts["expiring"],
            expired=counts["expired"],
            value_czk=round(value, 1),
            freshness_score=freshness,
            waste_month_czk=round(waste, 1),
        )

    # ------------------------------------------------------------------ zápis
    def create(self, data: InventoryItemCreate, *, source: str = "manual", emit: bool = True) -> InventoryItem:
        spec = find_spec(data.name)
        now = self.clock()
        expires = data.expires_on or estimate_expiry(spec, added=self.today())
        item = InventoryItem(
            id=f"itm_{uuid.uuid4().hex[:10]}",
            name=data.name,
            canonical=spec.key if spec else canonical_for(data.name),
            category=data.category if data.category != "other" or not spec else spec.category,
            emoji=spec.emoji if spec else "🥫",
            quantity=data.quantity,
            unit=data.unit,
            min_quantity=data.min_quantity or (spec.min_quantity if spec else 0),
            staple=data.staple or (spec.staple if spec else False),
            shelf=data.shelf if data.shelf != "unknown" or not spec else spec.shelf,
            expires_on=expires,
            expiry_source="manual" if data.expires_on else ("estimated" if expires else None),
            added_at=now,
            last_seen_at=now,
            price_czk=data.price_czk if data.price_czk is not None else (spec.typical_price_czk if spec else None),
            barcode=data.barcode,
        )
        item = self._save(item)
        if emit:
            self.events.emit(
                "item_added",
                f"{item.emoji} {item.name} je v lednici",
                detail=f"Zdroj: {source}",
                severity="success",
                item_id=item.id,
            )
            self.broadcast()
        return item

    def update(self, item_id: str, patch: InventoryItemUpdate) -> InventoryItem | None:
        item = self.store.get(ITEMS, item_id, InventoryItem)
        if item is None:
            return None
        changes = patch.model_dump(exclude_unset=True)
        if "expires_on" in changes:
            changes["expiry_source"] = "manual"
        old_qty = item.quantity * (item.fill_level if item.fill_level is not None else 1)
        item = self._save(item.model_copy(update=changes))
        new_qty = item.quantity * (item.fill_level if item.fill_level is not None else 1)
        if new_qty < old_qty:
            self._record_consumption(item, old_qty - new_qty)
        self._check_item_alerts(item)
        self.broadcast()
        return item

    def consume(self, item_id: str, amount: float | None = None) -> InventoryItem | None:
        """Ubere množství (výchozí 1 jednotka). Při nule položku vyřadí."""
        item = self.store.get(ITEMS, item_id, InventoryItem)
        if item is None:
            return None
        amount = amount if amount is not None else (1 if item.unit in ("ks", "bal") else item.quantity)
        remaining = max(0.0, item.quantity - amount)
        self._record_consumption(item, min(amount, item.quantity))
        if remaining <= 0:
            return self.remove(item_id, reason="consumed")
        item = self._save(item.model_copy(update={"quantity": remaining}))
        self._check_item_alerts(item)
        self.broadcast()
        return item

    def remove(self, item_id: str, *, reason: str = "consumed") -> InventoryItem | None:
        """Vyřadí položku. Základní potraviny zůstanou v seznamu s množstvím 0 (status 'out')."""
        item = self.store.get(ITEMS, item_id, InventoryItem)
        if item is None:
            return None
        item = self._with_status(item)
        wasted = reason == "wasted" or (reason == "consumed" and item.status == "expired")
        if wasted:
            czk = (item.price_czk or 0) * (item.fill_level if item.fill_level is not None else 1)
            self.store.put(
                WASTE,
                f"w_{uuid.uuid4().hex[:10]}",
                {"canonical": item.canonical, "name": item.name, "czk": round(czk, 1), "ts": self.clock().isoformat()},
                ts=self.clock(),
            )
        if item.staple:
            item = self._save(item.model_copy(update={"quantity": 0, "fill_level": None, "bbox": None}))
            self.events.emit(
                "item_out",
                f"{item.emoji} Došlo: {item.name}",
                detail="Patří mezi základní potraviny, přidávám ho do nákupu.",
                severity="warning",
                item_id=item.id,
                data={"canonical": item.canonical, "reason": reason},
            )
        else:
            self.store.delete(ITEMS, item_id)
            self.events.emit(
                "item_removed",
                f"{item.emoji} {item.name} {'skončil v koši' if wasted else 'zmizel z lednice'}",
                severity="warning" if wasted else "info",
                item_id=item.id,
                data={"canonical": item.canonical, "reason": "wasted" if wasted else reason},
            )
        self.broadcast()
        return item

    def restock(self, item_id: str, quantity: float | None = None) -> InventoryItem | None:
        item = self.store.get(ITEMS, item_id, InventoryItem)
        if item is None:
            return None
        spec = BY_KEY.get(item.canonical)
        qty = quantity or (spec.default_qty if spec else 1)
        expires = estimate_expiry(spec, added=self.today()) or item.expires_on
        item = self._save(
            item.model_copy(
                update={
                    "quantity": qty,
                    "fill_level": 1.0 if item.fill_level is not None else None,
                    "expires_on": expires,
                    "expiry_source": "estimated" if spec else item.expiry_source,
                    "last_seen_at": self.clock(),
                }
            )
        )
        self.events.emit("item_added", f"{item.emoji} Doplněno: {item.name}", severity="success", item_id=item.id)
        self.broadcast()
        return item

    # ------------------------------------------------------------------ kamera
    def apply_observation(self, obs: Observation) -> InventoryDiff:
        """Spáruje detekce s inventářem jedné kamery a vrátí, co přibylo/ubylo/změnilo se."""
        current = [
            i for i in self.store.list(ITEMS, InventoryItem) if i.camera_id == obs.camera_id and i.quantity > 0
        ]
        detections = [d for d in obs.detections if d.confidence >= MIN_DETECTION_CONFIDENCE]
        diff = InventoryDiff()
        now = obs.taken_at

        pairs: list[tuple[float, int, InventoryItem]] = []
        for di, det in enumerate(detections):
            for item in current:
                same = 1.0 if det.canonical == item.canonical else similarity(det.label, item.name)
                if same < 0.6:
                    continue
                overlap = iou(det.bbox, item.bbox)
                pairs.append((same * 0.6 + overlap * 0.4 + (0.2 if overlap > 0.2 else 0), di, item))
        pairs.sort(key=lambda t: -t[0])
        used_det: set[int] = set()
        used_item: set[str] = set()
        for _score, di, item in pairs:
            if di in used_det or item.id in used_item:
                continue
            used_det.add(di)
            used_item.add(item.id)
            changed = self._update_from_detection(item, detections[di], now)
            if changed is not None:
                diff.changed.append(changed)

        for di, det in enumerate(detections):
            if di in used_det:
                continue
            diff.added.append(self._add_from_detection(det, obs))

        for item in current:
            if item.id in used_item:
                self._misses.pop(item.id, None)
                continue
            self._misses[item.id] += 1
            # Odebrání hned, když se změnila oblast, kde položka stála. Jinak až po dvou
            # po sobě jdoucích snímcích bez ní (může být jen zakrytá jinou věcí).
            if overlaps_any(item.bbox, obs.changed_regions) or self._misses[item.id] >= 2:
                self._misses.pop(item.id, None)
                removed = self.remove(item.id, reason="taken")
                if removed:
                    diff.removed.append(removed)

        if diff.added or diff.changed:
            self.broadcast()
        return diff

    def _update_from_detection(self, item: InventoryItem, det: Detection, now: datetime) -> InventoryItem | None:
        updates: dict[str, Any] = {"last_seen_at": now, "bbox": det.bbox, "confidence": det.confidence}
        changed = False
        if det.fill_level is not None and item.fill_level is not None and abs(det.fill_level - item.fill_level) >= 0.15:
            if det.fill_level < item.fill_level:
                self._record_consumption(item, item.quantity * (item.fill_level - det.fill_level))
            updates["fill_level"] = det.fill_level
            changed = True
        elif det.fill_level is not None and item.fill_level is None:
            updates["fill_level"] = det.fill_level
        if det.quantity is not None and det.quantity != item.quantity and det.quantity > 0:
            if det.quantity < item.quantity:
                self._record_consumption(item, item.quantity - det.quantity)
            updates["quantity"] = det.quantity
            changed = True
        if det.expires_on and item.expiry_source in (None, "estimated", "vision"):
            updates["expires_on"] = det.expires_on
            updates["expiry_source"] = "ocr" if det.expiry_text else "vision"
            changed = changed or det.expires_on != item.expires_on
        new = self._save(item.model_copy(update=updates))
        if changed:
            self.events.emit(
                "item_changed",
                f"{new.emoji} {new.name}: změna",
                detail=self._describe_change(item, new),
                item_id=new.id,
                camera_id=new.camera_id,
            )
            self._check_item_alerts(new)
            return new
        return None

    def _add_from_detection(self, det: Detection, obs: Observation) -> InventoryItem:
        spec = BY_KEY.get(det.canonical) or find_spec(det.label)
        expires = det.expires_on or estimate_expiry(spec, added=self.today())
        source = "ocr" if det.expires_on and det.expiry_text else ("vision" if det.expires_on else "estimated")
        item = InventoryItem(
            id=f"itm_{uuid.uuid4().hex[:10]}",
            name=spec.name if spec else det.label.capitalize(),
            canonical=spec.key if spec else det.canonical,
            category=spec.category if spec else det.category,
            emoji=spec.emoji if spec else "🥫",
            quantity=det.quantity or (spec.default_qty if spec else 1),
            unit=det.unit or (spec.unit if spec else "ks"),
            fill_level=det.fill_level,
            min_quantity=spec.min_quantity if spec else 0,
            staple=spec.staple if spec else False,
            shelf=det.shelf if det.shelf != "unknown" else (spec.shelf if spec else "unknown"),
            camera_id=obs.camera_id,
            bbox=det.bbox,
            expires_on=expires,
            expiry_source=source if expires else None,
            added_at=obs.taken_at,
            last_seen_at=obs.taken_at,
            confidence=det.confidence,
            price_czk=spec.typical_price_czk if spec else None,
        )
        # Základní potravina, která došla, se jen "doplní" (zachová se historie).
        for existing in self.store.list(ITEMS, InventoryItem):
            if existing.canonical == item.canonical and existing.quantity <= 0:
                item = item.model_copy(update={"id": existing.id, "min_quantity": existing.min_quantity, "staple": True})
                break
        item = self._save(item)
        self.events.emit(
            "item_added",
            f"{item.emoji} Přibylo: {item.name}",
            detail=f"Kamera {obs.camera_id}, jistota {round(det.confidence * 100)} %"
            + (f", spotřebujte do {item.expires_on:%d. %m.}" if item.expires_on else ""),
            severity="success",
            item_id=item.id,
            camera_id=obs.camera_id,
            image_url=obs.image_url,
        )
        return item

    @staticmethod
    def _describe_change(old: InventoryItem, new: InventoryItem) -> str:
        parts = []
        if old.fill_level != new.fill_level and new.fill_level is not None:
            parts.append(f"zbývá asi {round(new.fill_level * 100)} %")
        if old.quantity != new.quantity:
            parts.append(f"množství {old.quantity:g} → {new.quantity:g} {new.unit}")
        if old.expires_on != new.expires_on and new.expires_on:
            parts.append(f"datum spotřeby {new.expires_on:%d. %m. %Y}")
        return ", ".join(parts) or "aktualizováno"

    # ------------------------------------------------------------------ upozornění
    def _alert_once(self, kind: str, item: InventoryItem) -> bool:
        key = f"{kind}:{item.id}:{self.today().isoformat()}"
        if self.store.get_raw(ALERTS, key):
            return False
        self.store.put(ALERTS, key, {"kind": kind, "item_id": item.id}, ts=self.clock())
        return True

    def _check_item_alerts(self, item: InventoryItem) -> None:
        item = self._with_status(item)
        if item.status == "low" and self._alert_once("low", item):
            self.events.emit(
                "item_low",
                f"{item.emoji} Dochází: {item.name}",
                detail=self._low_detail(item),
                severity="warning",
                item_id=item.id,
                data={"canonical": item.canonical},
            )
        elif item.status == "expiring" and self._alert_once("expiring", item):
            when = "dnes" if item.days_left == 0 else ("zítra" if item.days_left == 1 else f"za {item.days_left} dny")
            self.events.emit(
                "item_expiring",
                f"{item.emoji} {item.name} expiruje {when}",
                detail="Navrhnu recept, ve kterém ho spotřebuješ.",
                severity="warning",
                item_id=item.id,
                data={"canonical": item.canonical, "days_left": item.days_left},
            )
        elif item.status == "expired" and self._alert_once("expired", item):
            self.events.emit(
                "item_expired",
                f"{item.emoji} {item.name} je po datu spotřeby",
                detail="Zkontroluj ho, než ho sníš.",
                severity="critical",
                item_id=item.id,
                data={"canonical": item.canonical},
            )

    @staticmethod
    def _low_detail(item: InventoryItem) -> str:
        if item.fill_level is not None:
            return f"Zbývá asi {round(item.fill_level * 100)} %."
        return f"Zbývá {item.quantity:g} {item.unit}, hranice je {item.min_quantity:g}."

    def check_alerts(self) -> None:
        for item in self.list():
            self._check_item_alerts(item)

    # ------------------------------------------------------------------ spotřeba
    def _record_consumption(self, item: InventoryItem, amount: float) -> None:
        if amount <= 0:
            return
        self.store.put(
            CONSUMPTION,
            f"c_{uuid.uuid4().hex[:10]}",
            {
                "canonical": item.canonical,
                "name": item.name,
                "emoji": item.emoji,
                "amount": round(amount, 3),
                "unit": item.unit,
                "ts": self.clock().isoformat(),
            },
            ts=self.clock(),
        )

    def _rate_per_day(self, canonical: str, window_days: int = 28) -> float:
        since = self.clock() - timedelta(days=window_days)
        rows = [r for r in self.store.list_raw(CONSUMPTION, since=since) if r["canonical"] == canonical]
        if not rows:
            return 0.0
        first = min(datetime.fromisoformat(r["ts"]) for r in rows)
        span_days = max(7.0, (self.clock() - first).total_seconds() / 86400)
        return sum(r["amount"] for r in rows) / span_days

    def _predict_out(self, item: InventoryItem) -> date | None:
        if item.quantity <= 0:
            return None
        rate = self._rate_per_day(item.canonical)
        if rate <= 0:
            return None
        left = item.quantity * (item.fill_level if item.fill_level is not None else 1)
        return self.today() + timedelta(days=int(left / rate))

    def consumption_stats(self) -> list[ConsumptionStat]:
        by_canonical: dict[str, dict[str, Any]] = {}
        for row in self.store.list_raw(CONSUMPTION, since=self.clock() - timedelta(days=28)):
            by_canonical.setdefault(row["canonical"], row)
        items = {i.canonical: i for i in self.list()}
        stats = []
        for canonical, row in by_canonical.items():
            rate = self._rate_per_day(canonical)
            item = items.get(canonical)
            stats.append(
                ConsumptionStat(
                    canonical=canonical,
                    name=row["name"],
                    emoji=row["emoji"],
                    per_week=round(rate * 7, 2),
                    unit=row["unit"],
                    predicted_out_on=item.predicted_out_on if item else None,
                )
            )
        return sorted(stats, key=lambda s: -s.per_week)

    def shopping_needs(self, horizon_days: int = 3) -> list[InventoryItem]:
        """Co dokoupit: došlé a docházející základní potraviny + co podle spotřeby brzy dojde."""
        limit = self.today() + timedelta(days=horizon_days)
        needs = []
        for item in self.list():
            if item.status in ("out", "low") and (item.staple or item.min_quantity > 0):
                needs.append(item)
            elif item.predicted_out_on and item.predicted_out_on <= limit and item.staple:
                needs.append(item)
        return needs

    def waste_by_month(self, months: int = 6) -> list[dict[str, Any]]:
        buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"czk": 0.0, "items": 0})
        for row in self.store.list_raw(WASTE):
            month = datetime.fromisoformat(row["ts"]).astimezone(self.tz).strftime("%Y-%m")
            buckets[month]["czk"] += row["czk"]
            buckets[month]["items"] += 1
        out = []
        cursor = self.today().replace(day=1)
        for _ in range(months):
            key = cursor.strftime("%Y-%m")
            out.append({"month": key, "czk": round(buckets[key]["czk"], 1), "items": int(buckets[key]["items"])})
            cursor = (cursor - timedelta(days=1)).replace(day=1)
        return list(reversed(out))
