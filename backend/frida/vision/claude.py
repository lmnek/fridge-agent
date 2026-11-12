"""Rozpoznávání potravin pomocí Claude (vision + strukturovaný výstup).

Claude je "pomalý, chytrý" stupeň: přesně pojmenuje produkt, odhadne množství
a hladinu a přečte datum, pokud je na snímku čitelné. V kaskádě ho volá
lokální ViT jen tehdy, když si sám není jistý.
"""

from __future__ import annotations

import base64
import io
import json
import logging
from datetime import date

from anthropic import AsyncAnthropic
from PIL import Image
from pydantic import BaseModel

from ..ai import request_kwargs
from ..camera.base import Frame
from ..config import Settings
from ..food.catalog import BY_KEY, CATALOG, find_spec
from ..schemas import BBox, Detection
from .base import VisionContext, VisionUnavailable
from .expiry import parse_expiry

log = logging.getLogger(__name__)

MAX_EDGE = 1568  # delší hrana obrázku pro Claude (víc nepřidá přesnost, jen tokeny)
CATEGORIES = sorted({s.category for s in CATALOG} | {"other"})
SHELVES = ["top", "middle", "bottom", "door", "drawer", "unknown"]


class _SeenItem(BaseModel):
    label: str
    catalog_key: str
    category: str
    box_x: float
    box_y: float
    box_w: float
    box_h: float
    confidence: float
    count: float | None
    fill_level: float | None
    shelf: str
    expiry_text: str | None


class _SceneReading(BaseModel):
    door_open: bool
    items: list[_SeenItem]
    note: str


class _LabelReading(BaseModel):
    product: str
    catalog_key: str
    expiry_text: str | None
    expiry_date: str | None
    confidence: float
    note: str


SYSTEM = """Jsi zrak chytré lednice Frida v české domácnosti. Dostaneš snímek z kamery uvnitř lednice.

Úkol: vypiš každou potravinu nebo nápoj, který na snímku vidíš.
- `catalog_key`: vyber nejbližší klíč z katalogu níže. Když nic nesedí, napiš "other" a do `label` dej přesný český název.
- `label`: krátký český název, jak by ho řekl člověk (např. "mléko Madeta 1 l").
- Box: normalizované souřadnice 0..1 vůči celému snímku, levý horní roh (`box_x`, `box_y`), šířka a výška. Ohraničuj jen tu jednu věc.
- `count`: počet kusů, když jich je víc stejných (vejce v plato, rajčata). Jinak null.
- `fill_level`: jen u průhledných lahví nebo když je hladina zřejmá, 0..1. Jinak null.
- `shelf`: top | middle | bottom | door | drawer | unknown.
- `expiry_text`: datum spotřeby PŘESNĚ tak, jak je vytištěné, jen když je opravdu čitelné. Nikdy si datum nevymýšlej ani neodhaduj, raději null.
- `confidence`: jak moc si jsi jistý, 0..1.
- `door_open`: false, když je snímek tmavý nebo černobílý z IR přísvitu (dveře zavřené).

Katalog (klíč: název):
{catalog}
"""


def _catalog_text() -> str:
    return "\n".join(f"- {s.key}: {s.name}" for s in CATALOG)


def _prepare_jpeg(jpeg: bytes) -> tuple[str, int, int]:
    with Image.open(io.BytesIO(jpeg)) as img:
        img = img.convert("RGB")
        scale = min(1.0, MAX_EDGE / max(img.size))
        if scale < 1.0:
            img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88)
        return base64.standard_b64encode(buf.getvalue()).decode(), img.width, img.height


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


class ClaudeVisionProvider:
    name = "claude"

    def __init__(self, client: AsyncAnthropic | None, settings: Settings) -> None:
        self.client = client
        self.settings = settings

    async def analyze(self, frame: Frame, context: VisionContext) -> list[Detection]:
        if self.client is None:
            raise VisionUnavailable("Chybí ANTHROPIC_API_KEY")
        data, _, _ = _prepare_jpeg(frame.jpeg)
        known = [
            {"name": i.name, "key": i.canonical, "box": i.bbox.model_dump() if i.bbox else None}
            for i in context.known_items
        ]
        prompt = (
            f"Kamera: {context.camera_name}. Dnes je {context.today_iso or date.today().isoformat()}.\n"
            "Co jsme na této kameře viděli minule (pomůže ti držet stejné názvy, ale věř hlavně snímku):\n"
            f"{json.dumps(known, ensure_ascii=False)}"
        )
        response = await self.client.beta.messages.parse(
            **request_kwargs(self.settings, self.settings.vision_effort),
            max_tokens=16000,
            system=SYSTEM.format(catalog=_catalog_text()),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            output_format=_SceneReading,
        )
        if response.stop_reason == "refusal":
            log.warning("vision: model odmítl snímek (%s)", getattr(response, "stop_details", None))
            return []
        reading = response.parsed_output
        if reading is None:
            return []
        today = date.fromisoformat(context.today_iso) if context.today_iso else date.today()
        out: list[Detection] = []
        for it in reading.items:
            spec = BY_KEY.get(it.catalog_key) or find_spec(it.label)
            parsed = parse_expiry(it.expiry_text, today=today) if it.expiry_text else None
            out.append(
                Detection(
                    label=it.label,
                    canonical=spec.key if spec else it.catalog_key if it.catalog_key != "other" else it.label.lower(),
                    category=(spec.category if spec else (it.category if it.category in CATEGORIES else "other")),  # type: ignore[arg-type]
                    bbox=BBox(x=_clamp(it.box_x), y=_clamp(it.box_y), w=_clamp(it.box_w), h=_clamp(it.box_h)),
                    confidence=_clamp(it.confidence),
                    quantity=it.count,
                    unit=spec.unit if spec else None,
                    fill_level=_clamp(it.fill_level) if it.fill_level is not None else None,
                    shelf=it.shelf if it.shelf in SHELVES else "unknown",  # type: ignore[arg-type]
                    expiry_text=it.expiry_text,
                    expires_on=parsed.on if parsed else None,
                    source="claude",
                )
            )
        return out

    async def read_label(self, jpeg: bytes, *, today: date | None = None) -> dict:
        """Přečte z fotky z mobilu název výrobku a datum spotřeby (funkce 'Skenovat datum')."""
        if self.client is None:
            raise VisionUnavailable("Chybí ANTHROPIC_API_KEY")
        today = today or date.today()
        data, _, _ = _prepare_jpeg(jpeg)
        response = await self.client.beta.messages.parse(
            **request_kwargs(self.settings, self.settings.vision_effort),
            max_tokens=4000,
            system=(
                "Čteš etikety potravin. Vrať název výrobku česky, nejbližší klíč z katalogu "
                "(nebo 'other') a datum spotřeby přesně tak, jak je vytištěné. "
                "Datum převeď i do ISO (YYYY-MM-DD). Když datum není čitelné, vrať null. Nic si nevymýšlej.\n"
                f"Katalog:\n{_catalog_text()}"
            ),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
                        {"type": "text", "text": f"Dnes je {today.isoformat()}. Co je to a do kdy to vydrží?"},
                    ],
                }
            ],
            output_format=_LabelReading,
        )
        reading = response.parsed_output
        if response.stop_reason == "refusal" or reading is None:
            return {"product": None, "canonical": None, "expires_on": None, "expiry_text": None, "confidence": 0}
        parsed = parse_expiry(reading.expiry_text or reading.expiry_date or "", today=today)
        spec = BY_KEY.get(reading.catalog_key) or find_spec(reading.product)
        return {
            "product": reading.product,
            "canonical": spec.key if spec else None,
            "expires_on": parsed.on.isoformat() if parsed else reading.expiry_date,
            "expiry_text": reading.expiry_text,
            "expiry_kind": parsed.kind if parsed else "unknown",
            "confidence": _clamp(reading.confidence),
            "note": reading.note,
        }
