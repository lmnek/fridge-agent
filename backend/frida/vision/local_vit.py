"""Lokální vision transformery (běží doma, bez cloudu).

Tři stupně, všechno jsou modely z rodiny ViT:
1. OWLv2 (open-vocabulary detektor): najde v obrázku věci podle anglických
   dotazů z katalogu ("a carton of milk", "an egg carton"...) a několika obecných
   dotazů ("a jar", "a bottle"...), aby zachytil i věci mimo katalog.
2. SigLIP 2 (zero-shot klasifikace výřezů): každý nalezený výřez porovná se všemi
   popisy z katalogu (anglický popis + český název z obalu) a s pozadím (prázdná
   police, přihrádka). Detektor dává jen slabou nápovědu, název určuje SigLIP.
3. Florence-2 (OCR s oblastmi): na větších výřezech zkusí přečíst datum spotřeby.
   Volitelné a časově omezené. Z kamery v lednici je datum vysoké jen pár pixelů,
   takže většinou se nepřečte a to je v pořádku (pak se expirace odhadne).

Instalace: `uv sync --extra vision-local --extra reolink` (PyTorch + transformers).
Modely se stáhnou při prvním použití do cache Hugging Face.

Tenhle modul se načítá líně (torch a transformers až uvnitř metod), takže Frida
běží i bez PyTorch. Bez knihoven nebo modelů hlásí `VisionUnavailable` a kaskáda
pak použije Clauda.

Předzpracování pro OWLv2 i SigLIP děláme sami (Pillow + numpy). Procesory
z transformers by pro OWLv2 potřebovaly navíc scipy nebo torchvision.
"""

from __future__ import annotations

import asyncio
import io
import logging
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
from PIL import Image

from ..camera.base import Frame
from ..config import Settings
from ..food.catalog import BY_KEY, CATALOG, all_vision_prompts
from ..schemas import BBox, Detection, Shelf
from ..text import strip_diacritics
from .base import VisionContext, VisionUnavailable
from .expiry import ParsedExpiry, parse_expiry

log = logging.getLogger(__name__)

INSTALL_HINT = "uv sync --extra vision-local --extra reolink"
FLORENCE_OCR = "florence-community/Florence-2-base"

# Obecné dotazy pro detektor: najdou i věc, kterou katalog nezná. Jméno pak dá SigLIP.
GENERIC_QUERIES = ("a food package", "a bottle", "a jar", "a box", "a plastic container")
# Popisy pozadí pro SigLIP. Když výřez vyhraje pozadí, není to potravina (police, přihrádka).
BACKGROUND_PROMPTS = (
    "an empty glass shelf",
    "an empty refrigerator door bin",
    "an empty plastic drawer",
    "the white plastic wall of a refrigerator",
    "a refrigerator light",
)
BACKGROUND = ""

# OWLv2 (CLIP) normalizace a šedá výplň do čtverce (0.5 jako v původní implementaci)
OWL_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
OWL_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
PAD_GRAY = (128, 128, 128)

MAX_RAW_BOXES = 300  # kolik nejlepších boxů z detektoru vůbec zpracovat
MAX_CANDIDATES = 40  # kolik výřezů nejvýš poslat do SigLIP
NMS_IOU = 0.45
CONTAINED = 0.8  # box z 80 % uvnitř silnějšího boxu = jeho část (vejce v platu)
MAX_BOX_W, MAX_BOX_H, MAX_BOX_AREA = 0.55, 0.75, 0.25  # větší boxy jsou police, stěny, celé dveře
MIN_BOX_PX = 10
CROP_PAD = 0.06
OWL_PRIOR = 0.5  # váha nápovědy detektoru vůči SigLIP (v logitech)

OCR_BUDGET_S = 4.0  # víc času na snímek OCR nedostane, zbytek výřezů se přeskočí
OCR_RETRY_S = 30 * 60.0  # stejnou věc na stejné kameře znovu číst nejdřív za 30 minut
OCR_MIN_SIDE_PX = 48  # menší výřez nemá šanci obsahovat čitelné datum
OCR_SKIP_CATEGORIES = {"vegetables", "fruit"}  # volná zelenina a ovoce datum nemá
OCR_PRIORITY = {"meat": 0, "fish": 0, "deli": 1, "dairy": 1, "cheese": 2, "ready_meals": 2, "eggs": 3}

RETRY_AFTER_S = 300.0  # po neúspěšném načtení modelů to znovu zkusit až za 5 minut

_CLOCK = re.compile(r"\d{1,2}:\d{2}")  # časové razítko kamery (OSD), ne datum spotřeby
_FULL_DATE = re.compile(r"(?<!\d)\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}(?!\d)")


# ---------------------------------------------------------------------------
# Pomocné funkce (bez torch, testují se samostatně)
# ---------------------------------------------------------------------------


def models_cached(settings: Settings) -> bool:
    """Jsou detektor a klasifikátor už stažené v cache Hugging Face?"""
    try:
        from huggingface_hub import try_to_load_from_cache
    except ImportError:
        return False
    for repo in (settings.local_vision_detector, settings.local_vision_classifier):
        if not isinstance(try_to_load_from_cache(repo, "config.json"), str):
            return False
    return True


def ocr_engine(model_id: str) -> str | None:
    """Jaký OCR stupeň použít: "florence", None (vypnuto) nebo "unsupported"."""
    name = (model_id or "").strip().lower()
    if name in ("", "none", "off", "false", "0"):
        return None
    if "florence" in name:
        return "florence"
    # TrOCR čte jen jeden předem vyříznutý řádek. Na celém výřezu obalu vrací nesmysly.
    return "unsupported"


def shelf_for(center_y: float, camera_name: str) -> Shelf:
    """Hrubý odhad police podle svislé polohy středu boxu (0 = horní okraj snímku)."""
    name = strip_diacritics(camera_name or "").lower()
    if "dver" in name or "door" in name:
        return "door"
    if center_y < 0.36:
        return "top"
    if center_y < 0.62:
        return "middle"
    if center_y < 0.84:
        return "bottom"
    return "drawer"


def pick_expiry(lines: list[str], *, today: date, taken_on: date | None) -> tuple[str, ParsedExpiry] | None:
    """Z řádků OCR vybere datum spotřeby. Raději nic než špatné datum.

    Přečtené datum se v inventáři už nepřepíše odhadem, proto jsme přísní:
    - řádek s časem (hh:mm) je razítko kamery, ne obal,
    - datum shodné s dnem pořízení snímku je skoro jistě razítko kamery,
    - bez klíčového slova ("spotřebujte do", "DMT"...) bereme jen celé datum dd.mm.rrrr.
    """
    cleaned = [ln.replace("</s>", "").replace("<s>", "").strip() for ln in lines]
    cleaned = [ln for ln in cleaned if ln]
    candidates = list(cleaned)
    if len(cleaned) > 1:
        candidates.append(" ".join(cleaned))  # "Spotřebujte do:" a datum bývají na dvou řádcích
    for text in candidates:
        if _CLOCK.search(text):
            continue
        parsed = parse_expiry(text, today=today)
        if parsed is None:
            continue
        if taken_on is not None and parsed.on == taken_on:
            continue
        if parsed.kind == "unknown" and not _FULL_DATE.search(text):
            continue
        return text, parsed
    return None


def _iou(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _inside(inner: tuple[float, ...], outer: tuple[float, ...]) -> float:
    """Jaká část plochy `inner` leží uvnitř `outer` (0..1)."""
    ix = max(0.0, min(inner[2], outer[2]) - max(inner[0], outer[0]))
    iy = max(0.0, min(inner[3], outer[3]) - max(inner[1], outer[1]))
    area = (inner[2] - inner[0]) * (inner[3] - inner[1])
    return ix * iy / area if area > 0 else 0.0


def _contains_center(outer: tuple[float, ...], inner: tuple[float, ...]) -> bool:
    cx, cy = (inner[0] + inner[2]) / 2, (inner[1] + inner[3]) / 2
    return outer[0] <= cx <= outer[2] and outer[1] <= cy <= outer[3]


def _square(img: Image.Image) -> Image.Image:
    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGB", (side, side), PAD_GRAY)
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    return canvas


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return np.log(p) - np.log1p(-p)


@dataclass
class Candidate:
    """Box z detektoru. Souřadnice v pixelech zdrojového snímku (x0, y0, x1, y1)."""

    box: tuple[float, float, float, float]
    score: float  # nejvyšší pravděpodobnost přes všechny dotazy
    owl: np.ndarray  # pravděpodobnost pro každý klíč katalogu (pořadí CATALOG)
    parts: list[tuple[float, float, float, float]] = field(default_factory=list)  # potlačené boxy uvnitř


def suppress(cands: list[Candidate]) -> list[Candidate]:
    """NMS bez ohledu na třídu + potlačení boxů ležících uvnitř silnějšího boxu.

    Potlačené vnitřní boxy si silnější box pamatuje jako `parts` (jednotlivá vejce
    v platu, rajčata ve skupině). Pak se z nich počítají kusy.
    """
    kept: list[Candidate] = []
    for c in sorted(cands, key=lambda c: -c.score):
        absorbed = False
        for k in kept:
            if _iou(c.box, k.box) >= NMS_IOU:
                absorbed = True
                break
            if _inside(c.box, k.box) >= CONTAINED:
                k.parts.append(c.box)
                absorbed = True
                break
        if not absorbed:
            kept.append(c)
    # Box, který obsahuje středy dvou a víc jiných přeživších, je skupina nebo police, ne věc.
    return [c for c in kept if sum(_contains_center(c.box, o.box) for o in kept if o is not c) < 2]


def count_parts(c: Candidate) -> int:
    """Kolik samostatných kusů je uvnitř boxu (0 = nevíme)."""
    area = (c.box[2] - c.box[0]) * (c.box[3] - c.box[1])
    pieces: list[tuple[float, float, float, float]] = []
    for p in c.parts:
        if (p[2] - p[0]) * (p[3] - p[1]) > 0.5 * area:
            continue  # skoro celý box, ne jeden kus
        if all(_iou(p, q) < 0.3 for q in pieces):
            pieces.append(p)
    return len(pieces) if len(pieces) >= 2 else 0


@dataclass
class Item:
    key: str
    confidence: float
    box: tuple[float, float, float, float]
    count: int  # 0 = nevíme, jinak počet viděných kusů


def merge_items(items: list[Item]) -> list[Item]:
    """Sloučí stejné věci vedle sebe (tři jogurty v řadě = jedna položka, 3 ks)."""
    out: list[Item] = []
    for it in sorted(items, key=lambda i: i.box[0]):
        for g in out:
            if g.key != it.key:
                continue
            gh, ih = g.box[3] - g.box[1], it.box[3] - it.box[1]
            v_overlap = min(g.box[3], it.box[3]) - max(g.box[1], it.box[1])
            gap = max(g.box[0], it.box[0]) - min(g.box[2], it.box[2])
            width = max(g.box[2] - g.box[0], it.box[2] - it.box[0])
            if v_overlap >= 0.5 * min(gh, ih) and gap <= 0.25 * width:
                g.box = (
                    min(g.box[0], it.box[0]),
                    min(g.box[1], it.box[1]),
                    max(g.box[2], it.box[2]),
                    max(g.box[3], it.box[3]),
                )
                g.count = max(g.count, 1) + max(it.count, 1)
                g.confidence = max(g.confidence, it.confidence)
                break
        else:
            out.append(Item(it.key, it.confidence, it.box, it.count))
    return out


# ---------------------------------------------------------------------------
# Modely
# ---------------------------------------------------------------------------


@dataclass
class _Models:
    torch: Any
    device: str
    dtype: Any
    detector: Any
    det_size: int
    query_embeds: Any  # (Q, D) na zařízení
    query_mask: Any  # (1, Q) bool
    query_key_idx: list[list[int]]  # pro každý klíč katalogu indexy jeho dotazů
    classifier: Any
    cls_size: int
    text_embeds: Any  # (T, D) normalizované, na zařízení
    text_key_idx: list[list[int]]  # pro každý klíč katalogu + pozadí indexy jeho popisů
    logit_scale: float
    logit_bias: float
    ocr_model: Any | None = None
    ocr_processor: Any | None = None


def _pooled(out: Any) -> Any:
    """`get_*_features` vrací podle verze transformers tenzor nebo výstup s `pooler_output`."""
    if hasattr(out, "pooler_output"):
        return out.pooler_output
    return out


def _pretrained(loader: Any, name: str, **kwargs: Any) -> Any:
    """Nejdřív z lokální cache (bez sítě), teprve pak stáhnout z Hugging Face."""
    try:
        return loader.from_pretrained(name, local_files_only=True, **kwargs)
    except Exception:
        log.info("local-vit: stahuji %s z Hugging Face (jen poprvé, může trvat několik minut)", name)
        return loader.from_pretrained(name, **kwargs)


class LocalViTProvider:
    """Lokální rozpoznávání: OWLv2 najde, SigLIP 2 pojmenuje, Florence-2 zkusí přečíst datum."""

    name = "local-vit"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.keys = [spec.key for spec in CATALOG]
        self._models: _Models | None = None
        self._load_lock = asyncio.Lock()
        self._infer_lock = threading.Lock()
        self._failure: str | None = None
        self._failed_at = 0.0
        # (kamera, klíč) -> kdy jsme naposledy zkoušeli číst datum. Bez toho by OCR jelo na každém snímku.
        self._ocr_tried: dict[tuple[str, str], float] = {}

    # ------------------------------------------------------------- veřejné API
    async def analyze(self, frame: Frame, context: VisionContext) -> list[Detection]:
        models = await self._ensure_loaded()
        return await asyncio.to_thread(self._analyze_locked, models, frame, context)

    async def warmup(self) -> None:
        """Načte (případně stáhne) modely předem, aby první snímek nečekal."""
        await self._ensure_loaded()

    def local_date(self, taken_at: datetime) -> date:
        """Den pořízení v místním čase domácnosti. Razítko kamery (OSD) je v místním čase, ne v UTC."""
        try:
            return taken_at.astimezone(ZoneInfo(self.settings.timezone)).date()
        except (KeyError, ValueError):  # neznámé pásmo nebo chybí tzdata
            return taken_at.astimezone().date()

    # ------------------------------------------------------------- načtení
    async def _ensure_loaded(self) -> _Models:
        if self._models is not None:
            return self._models
        async with self._load_lock:
            if self._models is not None:
                return self._models
            if self._failure and time.monotonic() - self._failed_at < RETRY_AFTER_S:
                raise VisionUnavailable(self._failure)
            try:
                self._models = await asyncio.to_thread(self._load)
            except VisionUnavailable as exc:
                self._failure, self._failed_at = str(exc), time.monotonic()
                raise
            self._failure = None
            return self._models

    def _device(self, torch: Any) -> str:
        pref = (self.settings.local_vision_device or "auto").strip().lower()
        if pref == "cuda" and not torch.cuda.is_available():
            raise VisionUnavailable("FRIDA_LOCAL_VISION_DEVICE=cuda, ale CUDA tu není. Použij auto nebo cpu.")
        if pref == "mps" and not torch.backends.mps.is_available():
            raise VisionUnavailable(
                "FRIDA_LOCAL_VISION_DEVICE=mps, ale Apple MPS tu není. Použij auto nebo cpu."
            )
        if pref in ("cuda", "mps", "cpu"):
            return pref
        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    def _load(self) -> _Models:
        try:
            import torch
            import transformers
        except ImportError as exc:
            missing = exc.name or "torch/transformers"
            raise VisionUnavailable(
                f"Lokální vision potřebuje PyTorch a transformers (chybí {missing}). Nainstaluj: {INSTALL_HINT}"
            ) from exc

        s = self.settings
        device = self._device(torch)
        dtype = torch.float16 if device == "cuda" else torch.float32
        started = time.perf_counter()
        try:
            t0 = time.perf_counter()
            det_tok = _pretrained(transformers.AutoTokenizer, s.local_vision_detector)
            detector = _pretrained(transformers.Owlv2ForObjectDetection, s.local_vision_detector)
            detector = detector.to(device=device, dtype=dtype).eval()
            log.info(
                "local-vit: detektor %s načten za %.1f s", s.local_vision_detector, time.perf_counter() - t0
            )

            t0 = time.perf_counter()
            cls_tok = _pretrained(transformers.AutoTokenizer, s.local_vision_classifier)
            classifier = _pretrained(transformers.AutoModel, s.local_vision_classifier)
            classifier = classifier.to(device=device, dtype=dtype).eval()
            log.info(
                "local-vit: klasifikátor %s načten za %.1f s",
                s.local_vision_classifier,
                time.perf_counter() - t0,
            )
        except VisionUnavailable:
            raise
        except Exception as exc:
            raise VisionUnavailable(
                f"Lokální modely se nepodařilo načíst ({type(exc).__name__}: {str(exc)[:200]}). "
                "Zkontroluj připojení k internetu (první stažení má asi 2 GB) a názvy modelů v nastavení."
            ) from exc

        with torch.inference_mode():
            # Dotazy pro detektor: katalog + obecné. Text se zakóduje jen jednou.
            prompts = all_vision_prompts()
            queries = [p for p, _ in prompts] + list(GENERIC_QUERIES)
            enc = det_tok(queries, padding="max_length", max_length=16, truncation=True, return_tensors="pt")
            q = _pooled(
                detector.owlv2.get_text_features(
                    input_ids=enc["input_ids"].to(device), attention_mask=enc["attention_mask"].to(device)
                )
            )
            query_key_idx = [[i for i, (_, k) in enumerate(prompts) if k == key] for key in self.keys]

            # Popisy pro klasifikátor: anglický popis + český název z obalu + pozadí.
            texts: list[tuple[str, str]] = []
            for spec in CATALOG:
                texts += [(f"a photo of {p}.", spec.key) for p in spec.vision_prompts]
                texts.append((f'a package labeled "{spec.name}".', spec.key))
            texts += [(p, BACKGROUND) for p in BACKGROUND_PROMPTS]
            enc = cls_tok(
                [t.lower() for t, _ in texts],
                padding="max_length",
                max_length=64,
                truncation=True,
                return_tensors="pt",
            )
            tv = _pooled(classifier.get_text_features(**{k: v.to(device) for k, v in enc.items()}))
            tv = tv / tv.norm(dim=-1, keepdim=True)
            text_key_idx = [
                [i for i, (_, k) in enumerate(texts) if k == key] for key in [*self.keys, BACKGROUND]
            ]

        models = _Models(
            torch=torch,
            device=device,
            dtype=dtype,
            detector=detector,
            det_size=int(detector.config.vision_config.image_size),
            query_embeds=q,
            query_mask=torch.ones(1, q.shape[0], dtype=torch.bool, device=device),
            query_key_idx=query_key_idx,
            classifier=classifier,
            cls_size=int(classifier.config.vision_config.image_size),
            text_embeds=tv,
            text_key_idx=text_key_idx,
            logit_scale=float(classifier.logit_scale.exp().item()),
            logit_bias=float(classifier.logit_bias.item()),
        )
        self._load_ocr(models, transformers)
        self._warmup(models)
        log.info("local-vit: připraveno na %s za %.1f s", device, time.perf_counter() - started)
        return models

    def _load_ocr(self, m: _Models, transformers: Any) -> None:
        model_id = self.settings.local_vision_ocr
        engine = ocr_engine(model_id)
        if engine is None:
            return
        if engine == "unsupported":
            log.warning(
                "local-vit: OCR model %s umí číst jen jeden předem vyříznutý řádek, OCR je vypnuté. "
                "Nastav FRIDA_LOCAL_VISION_OCR=%s.",
                model_id,
                FLORENCE_OCR,
            )
            return
        t0 = time.perf_counter()
        try:
            processor = _pretrained(transformers.AutoProcessor, model_id)
            model = _pretrained(transformers.Florence2ForConditionalGeneration, model_id)
            m.ocr_model = model.to(device=m.device, dtype=m.dtype).eval()
            m.ocr_processor = processor
            log.info("local-vit: OCR %s načteno za %.1f s", model_id, time.perf_counter() - t0)
        except Exception as exc:
            log.warning("local-vit: OCR %s se nepodařilo načíst (%s), pokračuji bez čtení dat", model_id, exc)

    def _warmup(self, m: _Models) -> None:
        """První průchod na MPS/CUDA kompiluje kernely (sekundy). Ať to nezaplatí první snímek."""
        t0 = time.perf_counter()
        blank = Image.new("RGB", (320, 240), (200, 200, 200))
        self._detect(m, blank, threshold=1.0)
        self._classify(m, blank, [Candidate((0, 0, 320, 240), 1.0, np.zeros(len(self.keys)))])
        if m.ocr_model is not None:
            self._ocr_lines(m, blank, max_new_tokens=4)
        log.info("local-vit: zahřátí modelů %.1f s", time.perf_counter() - t0)

    # ------------------------------------------------------------- inference
    def _analyze_locked(self, m: _Models, frame: Frame, context: VisionContext) -> list[Detection]:
        with self._infer_lock:
            return self._analyze(m, frame, context)

    def _analyze(self, m: _Models, frame: Frame, context: VisionContext) -> list[Detection]:
        t0 = time.perf_counter()
        image = Image.open(io.BytesIO(frame.jpeg)).convert("RGB")
        w, h = image.size
        cands = self._detect(m, image, threshold=self.settings.local_detection_threshold)
        t1 = time.perf_counter()
        items = self._classify(m, image, cands)
        items = merge_items(items)
        t2 = time.perf_counter()

        today = date.fromisoformat(context.today_iso) if context.today_iso else date.today()
        detections: list[Detection] = []
        for it in items:
            spec = BY_KEY[it.key]
            x0, y0, x1, y1 = it.box
            bbox = BBox(x=x0 / w, y=y0 / h, w=(x1 - x0) / w, h=(y1 - y0) / h)
            detections.append(
                Detection(
                    label=spec.name,
                    canonical=spec.key,
                    category=spec.category,
                    bbox=bbox,
                    confidence=round(it.confidence, 3),
                    # Kusy jen když jsme jich opravdu viděli víc. None = "nevím", inventář pak počet nemění.
                    quantity=float(it.count) if spec.unit == "ks" and it.count >= 2 else None,
                    unit=spec.unit,
                    fill_level=None,
                    shelf=shelf_for(bbox.y + bbox.h / 2, context.camera_name),
                    source="local-vit",
                )
            )
        ocr_done = self._read_expiry(
            m,
            image,
            detections,
            context,
            camera_id=frame.camera_id,
            today=today,
            taken_on=self.local_date(frame.taken_at),
        )
        t3 = time.perf_counter()
        log.info(
            "local-vit %s: %d kandidátů -> %d detekcí | detekce %.0f ms, klasifikace %.0f ms, "
            "OCR %.0f ms (%d výřezů), celkem %.0f ms",
            frame.camera_id,
            len(cands),
            len(detections),
            (t1 - t0) * 1000,
            (t2 - t1) * 1000,
            (t3 - t2) * 1000,
            ocr_done,
            (t3 - t0) * 1000,
        )
        return detections

    def _detect(self, m: _Models, image: Image.Image, *, threshold: float) -> list[Candidate]:
        torch = m.torch
        w, h = image.size
        side = max(w, h)
        canvas = Image.new("RGB", (side, side), PAD_GRAY)
        canvas.paste(image, (0, 0))  # OWLv2 doplňuje do čtverce vpravo a dole
        canvas = canvas.resize((m.det_size, m.det_size), Image.Resampling.BICUBIC)
        arr = (np.asarray(canvas, dtype=np.float32) / 255.0 - OWL_MEAN) / OWL_STD
        px = torch.from_numpy(np.ascontiguousarray(arr.transpose(2, 0, 1))).unsqueeze(0)
        with torch.inference_mode():
            fmap, _ = m.detector.image_embedder(pixel_values=px.to(device=m.device, dtype=m.dtype))
            b, gh, gw, d = fmap.shape
            feats = fmap.reshape(b, gh * gw, d)
            logits, _ = m.detector.class_predictor(feats, m.query_embeds.unsqueeze(0), m.query_mask)
            boxes = m.detector.box_predictor(feats, fmap)
        probs = logits[0].float().sigmoid().cpu().numpy()  # (patche, dotazy)
        boxes_np = boxes[0].float().cpu().numpy()  # cx, cy, w, h relativně ke čtverci
        best = probs.max(axis=1)
        idx = np.nonzero(best >= threshold)[0]
        idx = idx[np.argsort(-best[idx])][:MAX_RAW_BOXES]

        cands: list[Candidate] = []
        for i in idx:
            cx, cy, bw, bh = (boxes_np[i] * side).tolist()
            if cx > w or cy > h:
                continue  # střed v doplněném šedém okraji
            x0, y0 = max(0.0, cx - bw / 2), max(0.0, cy - bh / 2)
            x1, y1 = min(float(w), cx + bw / 2), min(float(h), cy + bh / 2)
            if x1 - x0 < MIN_BOX_PX or y1 - y0 < MIN_BOX_PX:
                continue
            nw, nh = (x1 - x0) / w, (y1 - y0) / h
            if nw > MAX_BOX_W or nh > MAX_BOX_H or nw * nh > MAX_BOX_AREA:
                continue  # police, stěna, celé dveře
            owl = np.array([probs[i, q].max() if q else 0.0 for q in m.query_key_idx], dtype=np.float32)
            cands.append(Candidate((x0, y0, x1, y1), float(best[i]), owl))
        return suppress(cands)[:MAX_CANDIDATES]

    def _classify(self, m: _Models, image: Image.Image, cands: list[Candidate]) -> list[Item]:
        if not cands:
            return []
        torch = m.torch
        w, h = image.size
        batch = []
        for c in cands:
            x0, y0, x1, y1 = c.box
            pw, ph = (x1 - x0) * CROP_PAD, (y1 - y0) * CROP_PAD
            crop = image.crop(
                (int(max(0, x0 - pw)), int(max(0, y0 - ph)), int(min(w, x1 + pw)), int(min(h, y1 + ph)))
            )
            crop = _square(crop).resize((m.cls_size, m.cls_size), Image.Resampling.BICUBIC)
            batch.append((np.asarray(crop, dtype=np.float32) / 255.0 - 0.5) / 0.5)
        px = torch.from_numpy(np.ascontiguousarray(np.stack(batch).transpose(0, 3, 1, 2)))
        with torch.inference_mode():
            feats = _pooled(
                m.classifier.get_image_features(pixel_values=px.to(device=m.device, dtype=m.dtype))
            )
            feats = feats / feats.norm(dim=-1, keepdim=True)
            sims = (feats @ m.text_embeds.T).float().cpu().numpy()  # (výřezy, popisy)

        per_key = np.stack(
            [sims[:, idx].max(axis=1) for idx in m.text_key_idx], axis=1
        )  # (výřezy, klíče+pozadí)
        logits = per_key * m.logit_scale + m.logit_bias
        items: list[Item] = []
        for i, c in enumerate(cands):
            # Nápověda detektoru: klíč, který OWLv2 vybral, nic neztrácí, ostatní klíče jsou mírně penalizované.
            owl_logit = _logit(c.owl)
            prior = np.append(OWL_PRIOR * (owl_logit - owl_logit.max()), 0.0)
            z = logits[i] + prior
            p = np.exp(z - z.max())
            p /= p.sum()
            best = int(p.argmax())
            if best == len(self.keys):
                continue  # pozadí: police, přihrádka, stěna
            # Jistota = jak jednoznačné je jméno x jak silně detektor věří, že tam něco je.
            strength = min(1.0, 0.6 + c.score)
            items.append(Item(self.keys[best], float(p[best]) * strength, c.box, count_parts(c)))
        return items

    # ------------------------------------------------------------- OCR
    def _ocr_lines(self, m: _Models, crop: Image.Image, *, max_new_tokens: int = 96) -> list[str]:
        torch = m.torch
        task = "<OCR_WITH_REGION>"
        inputs = m.ocr_processor(text=task, images=crop, return_tensors="pt")
        with torch.inference_mode():
            ids = m.ocr_model.generate(
                input_ids=inputs["input_ids"].to(m.device),
                pixel_values=inputs["pixel_values"].to(device=m.device, dtype=m.dtype),
                max_new_tokens=max_new_tokens,
                num_beams=1,
                do_sample=False,
            )
        raw = m.ocr_processor.batch_decode(ids, skip_special_tokens=False)[0]
        parsed = m.ocr_processor.post_process_generation(raw, task=task, image_size=crop.size)
        return list(parsed.get(task, {}).get("labels", []))

    def _read_expiry(
        self,
        m: _Models,
        image: Image.Image,
        detections: list[Detection],
        context: VisionContext,
        *,
        camera_id: str,
        today: date,
        taken_on: date | None,
    ) -> int:
        """Zkusí přečíst datum spotřeby na výřezech. Vrací počet zpracovaných výřezů."""
        if m.ocr_model is None or not detections:
            return 0
        w, h = image.size
        now = time.monotonic()
        # Kde už datum známe z obalu nebo od uživatele, znovu nečteme.
        settled = {i.canonical for i in context.known_items if i.expiry_source in ("ocr", "manual")}
        todo = []
        for det in detections:
            b = det.bbox
            if b is None or det.category in OCR_SKIP_CATEGORIES or det.canonical in settled:
                continue
            if now - self._ocr_tried.get((camera_id, det.canonical), -OCR_RETRY_S) < OCR_RETRY_S:
                continue
            bw, bh = b.w * w, b.h * h
            if min(bw, bh) < OCR_MIN_SIDE_PX:
                continue
            box = (int(b.x * w), int(b.y * h), int((b.x + b.w) * w), int((b.y + b.h) * h))
            todo.append((OCR_PRIORITY.get(det.category, 4), -bw * bh, det, box))
        todo.sort(key=lambda t: (t[0], t[1]))
        deadline = time.perf_counter() + OCR_BUDGET_S
        done = 0
        last = 0.0  # jak dlouho trval předchozí výřez (další by se do limitu nevešel)
        for _, _, det, box in todo:
            if time.perf_counter() + last > deadline:
                # Nepřečtené výřezy nejsou v `_ocr_tried`, takže přijdou na řadu u dalšího snímku.
                log.info(
                    "local-vit: OCR přeskočilo %d výřezů (časový limit %.0f s)",
                    len(todo) - done,
                    OCR_BUDGET_S,
                )
                break
            self._ocr_tried[(camera_id, det.canonical)] = now
            crop = image.crop(box)
            done += 1
            started = time.perf_counter()
            try:
                lines = self._ocr_lines(m, crop)
            except Exception as exc:
                log.warning("local-vit: OCR selhalo (%s)", exc)
                break
            last = time.perf_counter() - started
            found = pick_expiry(lines, today=today, taken_on=taken_on)
            if found:
                det.expiry_text, det.expires_on = found[0], found[1].on
                log.info("local-vit: %s datum z obalu %r -> %s", det.canonical, found[0], found[1].on)
        return done
